<?php

declare(strict_types=1);

/**
 * The Laravel package's tests.
 *
 * A plain PHP runner rather than phpunit, and deliberately so. Everything worth
 * testing here - the mapper, the sampler, the transport's retry and back
 * pressure - is plain PHP with no Illuminate dependency, which was the point of
 * separating them. Running them needs `php` and nothing else: no composer
 * install, no vendor directory, no network in CI. The parts that genuinely need
 * a booted application (the service provider's listener registration) are not
 * unit tested here, and that is stated rather than papered over.
 *
 *     php packages/laravel/tests/run.php
 */

require __DIR__.'/../src/Config.php';
require __DIR__.'/../src/Sampler.php';
require __DIR__.'/../src/Mapper.php';
require __DIR__.'/../src/Sender.php';
require __DIR__.'/../src/Transport.php';

use ReportsHQ\Laravel\Config;
use ReportsHQ\Laravel\Mapper;
use ReportsHQ\Laravel\Sampler;
use ReportsHQ\Laravel\Sender;
use ReportsHQ\Laravel\Transport;

/** Stands in for an application's own status cast, which is what Eloquent hands over. */
enum TestOrderStatus: string
{
    case Shipped = 'shipped';
}

final class Runner
{
    public int $passed = 0;

    /** @var string[] */
    public array $failures = [];

    public function test(string $name, callable $body): void
    {
        try {
            $body($this);
            $this->passed++;
        } catch (Throwable $error) {
            $this->failures[] = $name.': '.$error->getMessage();
        }
    }

    public function assert(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new RuntimeException($message);
        }
    }

    public function same(mixed $expected, mixed $actual, string $message): void
    {
        if ($expected !== $actual) {
            throw new RuntimeException(sprintf(
                '%s (expected %s, got %s)',
                $message,
                json_encode($expected, JSON_UNESCAPED_SLASHES),
                json_encode($actual, JSON_UNESCAPED_SLASHES),
            ));
        }
    }
}

$run = new Runner;
$all = ['commerce' => true, 'users' => true, 'cms' => true];

/*
 * The cross-SDK contract.
 *
 * docs/fixtures/sdk-events.json states, for each logical event, the one
 * taxonomy payload every SDK must produce. The Stacks package asserts the same
 * file from TypeScript. Without it the two drift, and the drift is invisible: a
 * Laravel app and a Stacks app doing the same thing produce reports that
 * quietly disagree, and nobody finds out until somebody compares them.
 */
/*
 * The fixture lives in the monorepo's docs, and this package is also mirrored
 * to its own repository for Packagist, where that path does not exist. Both
 * locations are tried so the mirror can run its own tests: a package people
 * install whose suite only passes somewhere else is not a suite.
 */
$fixturePath = null;

foreach ([__DIR__.'/../../../docs/fixtures/sdk-events.json', __DIR__.'/fixtures/sdk-events.json'] as $candidate) {
    if (is_file($candidate)) {
        $fixturePath = $candidate;
        break;
    }
}

if ($fixturePath === null) {
    echo "\n  FAIL  the cross-SDK fixture is missing from both known locations\n\n";
    exit(1);
}

$fixtures = json_decode((string) file_get_contents($fixturePath), true, 512, JSON_THROW_ON_ERROR);

$run->test('the fixture file has cases in it', function (Runner $run) use ($fixtures): void {
    // Guards the guard: an empty file would make every case below vacuous.
    $run->assert(count($fixtures['cases']) > 5, 'expected fixtures to contain cases');
});

foreach ($fixtures['cases'] as $case) {
    $run->test('fixture: '.$case['case'], function (Runner $run) use ($case, $all): void {
        $mapped = Mapper::map($case['laravel']['event'], $case['laravel']['payload'], $all);

        if ($case['expected'] === null) {
            $run->same(null, $mapped, 'expected this event not to be forwarded');

            return;
        }

        $run->assert($mapped !== null, 'expected this event to be mapped');

        // occurred_at is stamped at queue time unless the payload carried one,
        // so it is only compared when the fixture states it.
        if (! array_key_exists('occurred_at', $case['expected'])) {
            unset($mapped['occurred_at']);
        }

        // Sorted before comparing: the two SDKs must agree on content, not on
        // the order a language happens to build a map in.
        ksort($mapped);
        $expected = $case['expected'];
        ksort($expected);

        $run->same(
            json_encode($expected, JSON_UNESCAPED_SLASHES),
            json_encode($mapped, JSON_UNESCAPED_SLASHES),
            'payload does not match the shared fixture',
        );
    });
}

$run->test('an unmapped event is not forwarded under an invented name', function (Runner $run) use ($all): void {
    $run->same(null, Mapper::map('Widget:frobnicated', ['id' => 1], $all), 'expected null');
});

$run->test('a disabled domain maps nothing from that domain', function (Runner $run): void {
    $domains = ['commerce' => false, 'users' => true, 'cms' => true];

    $run->same(null, Mapper::map('Order:created', ['total' => 10], $domains), 'expected commerce to be off');
    $run->assert(Mapper::map('Registered', [], $domains) !== null, 'expected users to still map');
    $run->assert(! in_array('Order:created', Mapper::names($domains), true), 'expected the name list to exclude commerce');
});

$run->test('a numeric string total stays an integer', function (Runner $run) use ($all): void {
    // An ORM hands totals over as strings often enough that this decides
    // whether the payload matches the other SDK byte for byte.
    $mapped = Mapper::map('Order:created', ['id' => 1, 'total' => '4250'], $all);
    $run->same(4250, $mapped['value'], 'expected an int');
});

$run->test('a decimal total stays a float', function (Runner $run) use ($all): void {
    $mapped = Mapper::map('Order:created', ['id' => 1, 'total' => '42.50'], $all);
    $run->same(42.5, $mapped['value'], 'expected a float');
});

$run->test('empty properties are omitted, not sent as nulls', function (Runner $run) use ($all): void {
    $mapped = Mapper::map('Order:cancelled', [], $all);
    $run->assert(! array_key_exists('properties', $mapped), 'expected no properties key');
});

/*
 * Sampling.
 */
$run->test('a rate of one keeps everything and zero keeps nothing', function (Runner $run): void {
    $run->assert(Sampler::keep(['user_key' => 'a'], 1.0), 'expected keep');
    $run->assert(! Sampler::keep(['user_key' => 'a'], 0.0), 'expected drop');
});

$run->test('a subject is wholly in or wholly out', function (Runner $run): void {
    // The property that makes funnels survive sampling.
    $first = Sampler::keep(['user_key' => 'steady', 'name' => 'a'], 0.5);

    for ($index = 0; $index < 25; $index++) {
        $run->same($first, Sampler::keep(['user_key' => 'steady', 'name' => "e{$index}"], 0.5), 'expected a stable decision');
    }
});

$run->test('the hash matches the Stacks SDK', function (Runner $run): void {
    // Both SDKs use FNV-1a over the subject. If they diverge, an application
    // migrating between them gets a step change in its history at the
    // switchover rather than a continuous one.
    $run->same(0x811C9DC5, Sampler::hash(''), 'expected the FNV offset basis for an empty string');
    // "a" => offset basis xor 0x61, times the prime, in 32-bit space.
    $run->same(0xE40C292C, Sampler::hash('a'), 'expected the known FNV-1a value for "a"');
});

/*
 * The transport.
 */
function transportWith(array $overrides, array &$log): Transport
{
    $config = new Config(
        key: 'rhq_test',
        endpoint: 'https://example.invalid/ingest',
        batchSize: $overrides['batchSize'] ?? 50,
        maxBufferSize: $overrides['maxBufferSize'] ?? 10000,
        maxRetries: $overrides['maxRetries'] ?? 3,
        retryBaseMs: 0,
        onError: static function (string $message) use (&$log): void {
            $log[] = $message;
        },
    );

    $statuses = $overrides['statuses'] ?? [201];
    $calls = &$overrides['calls'];

    return new Transport($config, static function (string $endpoint, string $key, array $body) use (&$statuses, &$calls): int {
        $calls[] = ['key' => $key, 'events' => $body['events']];

        return array_shift($statuses) ?? 201;
    });
}

$run->test('a flush sends one batch with the key in the header', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls];
    $transport = transportWith($overrides, $log);

    $transport->track(['name' => 'user.login', 'user_key' => 'a']);
    $sent = $transport->flush();

    $run->same(1, $sent, 'expected one event delivered');
    $run->same(1, count($calls), 'expected one request');
    $run->same('rhq_test', $calls[0]['key'], 'expected the key to travel');
});

$run->test('every event carries a timestamp even when the payload had none', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls];
    $transport = transportWith($overrides, $log);

    $transport->track(['name' => 'user.login']);
    $transport->flush();

    $run->assert(str_contains($calls[0]['events'][0]['occurred_at'], 'T'), 'expected an ISO timestamp');
});

$run->test('a large buffer is split into batches', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls, 'batchSize' => 2, 'statuses' => [201, 201, 201]];
    $transport = transportWith($overrides, $log);

    for ($index = 0; $index < 5; $index++) {
        $transport->track(['name' => 'user.login', 'user_key' => "u{$index}"]);
    }

    $run->same(5, $transport->flush(), 'expected all five delivered');
    $run->same(3, count($calls), 'expected three requests');
});

$run->test('a 5xx is retried and then succeeds', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls, 'statuses' => [500, 503, 201]];
    $transport = transportWith($overrides, $log);

    $transport->track(['name' => 'user.login']);

    $run->same(1, $transport->flush(), 'expected eventual success');
    $run->same(3, count($calls), 'expected three attempts');
});

$run->test('a 4xx is not retried, because it will be wrong every time', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls, 'statuses' => [401]];
    $transport = transportWith($overrides, $log);

    $transport->track(['name' => 'user.login']);

    $run->same(0, $transport->flush(), 'expected no delivery');
    $run->same(1, count($calls), 'expected a single attempt');
    $run->assert(str_contains($log[0] ?? '', '401'), 'expected the status in the error');
});

$run->test('a 429 is retried, because it means later rather than no', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls, 'statuses' => [429, 201]];
    $transport = transportWith($overrides, $log);

    $transport->track(['name' => 'user.login']);

    $run->same(1, $transport->flush(), 'expected eventual success');
    $run->same(2, count($calls), 'expected a retry');
});

$run->test('a sender that throws does not throw into the caller', function (Runner $run): void {
    $config = new Config(key: 'k', endpoint: 'https://example.invalid', retryBaseMs: 0, maxRetries: 2);
    $transport = new Transport($config, static function (): int {
        throw new RuntimeException('network is down');
    });

    $transport->track(['name' => 'user.login']);

    // The whole promise of this package: analytics cannot take the app down.
    $run->same(0, $transport->flush(), 'expected a clean zero rather than an exception');
});

$run->test('the oldest events are dropped when the buffer is full', function (Runner $run): void {
    $log = [];
    $calls = [];
    $overrides = ['calls' => &$calls, 'maxBufferSize' => 3];
    $transport = transportWith($overrides, $log);

    for ($index = 0; $index < 5; $index++) {
        $transport->track(['name' => 'user.login', 'user_key' => "u{$index}"]);
    }

    $run->same(3, $transport->pending(), 'expected the buffer to be capped');
    $run->same(2, $transport->stats['dropped'], 'expected two drops');

    $transport->flush();
    // Recent events describe what is happening now, which is what somebody
    // watching a dashboard during an incident needs.
    $run->same('u2', $calls[0]['events'][0]['user_key'], 'expected the oldest to have gone');
});

$run->test('an unconfigured transport accepts nothing', function (Runner $run): void {
    $transport = new Transport(new Config(key: ''), static fn (): int => 201);
    $transport->track(['name' => 'user.login']);

    $run->same(0, $transport->pending(), 'expected nothing buffered without a key');
});

$run->test('flushing an empty buffer sends nothing', function (Runner $run): void {
    $calls = [];
    $transport = new Transport(new Config(key: 'k'), static function () use (&$calls): int {
        $calls[] = true;

        return 201;
    });

    $run->same(0, $transport->flush(), 'expected zero');
    $run->same(0, count($calls), 'expected no request');
});

$run->test('taking the buffer empties it, so the queued job cannot double send', function (Runner $run): void {
    $transport = new Transport(new Config(key: 'k', endpoint: 'https://example.invalid/ingest'), static fn (): int => 201);
    $transport->track(['name' => 'user.login']);

    $run->same(1, count($transport->take()), 'expected the batch');
    $run->same(0, $transport->pending(), 'expected the buffer emptied');
});

/*
 * What an application actually hands over.
 *
 * `toArray()` gives scalars, and the fixture cases are all written that way.
 * Real integrations are not: an application merges `$model->status` in by hand,
 * or passes `getAttributes()`, and then the payload holds the objects Eloquent
 * casts to. Mapping happens inline in the listener, before anything is
 * buffered, so nothing downstream was catching what casting one of those threw.
 */
$run->test('a backed enum in the payload reads as its value', function (Runner $run) use ($all): void {
    $mapped = Mapper::map('Order:created', [
        'id' => 9,
        'total' => 4250,
        'status' => TestOrderStatus::Shipped,
    ], $all);

    $run->same('shipped', $mapped['properties']['status'] ?? null, 'expected the enum read as its value');
});

$run->test('an object with no string reading is dropped rather than fatal', function (Runner $run) use ($all): void {
    $mapped = Mapper::map('Order:created', [
        'id' => 9,
        'total' => 4250,
        'status' => new stdClass,
    ], $all);

    $run->same('9', $mapped['properties']['order_id'] ?? null, 'expected the order still mapped');
    $run->assert(! isset($mapped['properties']['status']), 'expected the unreadable object dropped');
});

$run->test('a date object in the payload does not kill the request', function (Runner $run) use ($all): void {
    $mapped = Mapper::map('Order:created', [
        'id' => 9,
        'total' => 4250,
        'currency' => 'usd',
        'created_at' => new DateTimeImmutable('2026-03-04T05:06:07+00:00'),
    ], $all);

    $run->same('2026-03-04T05:06:07+00:00', $mapped['occurred_at'] ?? null, 'expected the timestamp used');
});

$run->test('a stringable value object is read rather than dropped', function (Runner $run) use ($all): void {
    $money = new class
    {
        public function __toString(): string
        {
            return '4250';
        }
    };

    $mapped = Mapper::map('Order:created', ['id' => 9, 'total' => $money], $all);

    $run->same(4250, $mapped['value'] ?? null, 'expected the total read through __toString');
});

/*
 * Config.
 */
$run->test('nonsense values fall back rather than breaking delivery', function (Runner $run): void {
    $config = new Config(key: 'k', sampleRate: 5.0, batchSize: 0, maxRetries: 99);

    $run->same(1.0, $config->sampleRate, 'expected the rate clamped');
    // A batch size of zero would hand array_chunk a zero and throw.
    $run->assert($config->batchSize >= 1, 'expected a usable batch size');
    $run->assert($config->maxRetries <= 10, 'expected retries clamped');
});

$run->test('a rate of zero switches the integration off entirely', function (Runner $run): void {
    $endpoint = 'https://example.invalid/ingest';

    $run->assert(! (new Config(key: 'k', endpoint: $endpoint, sampleRate: 0.0))->enabled(), 'expected disabled');
    $run->assert(! (new Config(key: '', endpoint: $endpoint))->enabled(), 'expected disabled without a key');
    $run->assert((new Config(key: 'k', endpoint: $endpoint))->enabled(), 'expected enabled');
});

$run->test('without an endpoint nothing is sent, rather than sent nowhere', function (Runner $run): void {
    // The endpoint defaulted to the hosted collector until that stopped
    // answering, which turned every configured install into one queued job per
    // login posting into a 404. The failure surfaced through `onError` inside a
    // queued job, so an application without a failed-job handler saw nothing.
    // A key alone is no longer enough to start sending.
    $run->assert(! (new Config(key: 'k'))->enabled(), 'expected disabled without an endpoint');
    $run->assert(! Config::fromArray(['key' => 'rhq_x'])->enabled(), 'expected disabled from an array too');
});

$run->test('config comes out of an array the way Laravel stores it', function (Runner $run): void {
    $config = Config::fromArray([
        'key' => 'rhq_x',
        'endpoint' => '',
        'domains' => ['cms' => false],
        'sample_rate' => 0.25,
        'queue' => '',
    ]);

    $run->same('rhq_x', $config->key, 'expected the key');
    // An empty endpoint means "unset", not "post to nowhere" — so it stays
    // empty and switches the event side off, rather than falling back to a
    // host this package does not run.
    $run->same('', $config->endpoint, 'expected an empty endpoint to stay empty');
    $run->assert(! $config->enabled(), 'expected no endpoint to mean disabled');
    $run->same(false, $config->domains['cms'], 'expected cms off');
    $run->same(true, $config->domains['users'], 'expected users to default on');
    $run->same(null, $config->queue, 'expected an empty queue to read as none');
});

/*
 * The real sender, over real HTTP.
 *
 * Every test above injects a fake sender, which is the right way to test retry
 * and back pressure and the wrong way to find out whether the header is
 * actually named X-ReportsHQ-Key on the wire. A fake agrees with whatever it is
 * handed, including the wrong thing, so this posts to a PHP built-in server and
 * reads back what arrived.
 */
$run->test('the built-in sender posts a taxonomy batch with the key header', function (Runner $run): void {
    $record = sys_get_temp_dir().'/reportshq-fake-ingest.json';
    @unlink($record);

    // Port 0 is not available to php -S, so a high port is picked and the
    // server is given a moment to bind.
    $port = 8000 + random_int(100, 900);
    $server = proc_open(
        sprintf('php -S 127.0.0.1:%d %s', $port, escapeshellarg(__DIR__.'/server.php')),
        [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
        $pipes,
    );

    if (! is_resource($server)) {
        throw new RuntimeException('could not start the fake ingest');
    }

    try {
        $ready = false;
        for ($attempt = 0; $attempt < 50; $attempt++) {
            $probe = @fsockopen('127.0.0.1', $port, $code, $message, 0.1);
            if (is_resource($probe)) {
                fclose($probe);
                $ready = true;
                break;
            }
            usleep(100000);
        }

        $run->assert($ready, 'the fake ingest never came up');

        $config = new Config(key: 'rhq_wire', endpoint: "http://127.0.0.1:{$port}/ingest", retryBaseMs: 0);
        $transport = new Transport($config, Sender::stream());

        $transport->track(['name' => 'commerce.order.created', 'value' => 4250, 'currency' => 'USD', 'user_key' => 'u1']);
        $delivered = $transport->flush();

        $run->same(1, $delivered, 'expected the event to be delivered');

        $received = json_decode((string) file_get_contents($record), true, 512, JSON_THROW_ON_ERROR);

        // The header name is the whole reason this test exists.
        $run->same('rhq_wire', $received['key'], 'expected the key in X-ReportsHQ-Key');
        $run->same('commerce.order.created', $received['body']['events'][0]['name'], 'expected the event name');
        $run->same(4250, $received['body']['events'][0]['value'], 'expected the value');
    } finally {
        proc_terminate($server);
        proc_close($server);
    }
});

$run->test('the built-in sender reports a refusal rather than throwing', function (Runner $run): void {
    $port = 8000 + random_int(100, 900);
    $server = proc_open(
        sprintf('php -S 127.0.0.1:%d %s', $port, escapeshellarg(__DIR__.'/server.php')),
        [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
        $pipes,
    );

    if (! is_resource($server)) {
        throw new RuntimeException('could not start the fake ingest');
    }

    try {
        for ($attempt = 0; $attempt < 50; $attempt++) {
            $probe = @fsockopen('127.0.0.1', $port, $code, $message, 0.1);
            if (is_resource($probe)) {
                fclose($probe);
                break;
            }
            usleep(100000);
        }

        $seen = [];
        $config = new Config(
            key: 'bad',
            // A 401 is what a wrong key looks like, and the sender has to read
            // the status off the response rather than treating it as a failure
            // to connect.
            endpoint: "http://127.0.0.1:{$port}/ingest?status=401",
            retryBaseMs: 0,
            onError: static function (string $message) use (&$seen): void {
                $seen[] = $message;
            },
        );

        $transport = new Transport($config, Sender::stream());
        $transport->track(['name' => 'user.login']);

        $run->same(0, $transport->flush(), 'expected no delivery');
        $run->assert(str_contains($seen[0] ?? '', '401'), 'expected the 401 to be reported, got: '.($seen[0] ?? 'nothing'));
    } finally {
        proc_terminate($server);
        proc_close($server);
    }
});

echo "\n";

foreach ($run->failures as $failure) {
    echo "  FAIL  {$failure}\n";
}

printf(
    "\n %d pass, %d fail\n\n",
    $run->passed,
    count($run->failures),
);

exit($run->failures === [] ? 0 : 1);
