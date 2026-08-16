<?php

declare(strict_types=1);

/**
 * The licence's tests.
 *
 * Short, because the class is short on purpose. What is worth asserting is that
 * it never gates anything and never reaches the network, and the second is a
 * property of there being no code that could.
 *
 *     php packages/laravel/tests/license.php
 */

require __DIR__.'/../src/License.php';

use ReportsHQ\Laravel\License;

$passed = 0;
$failures = [];

function check(string $name, bool $condition): void
{
    global $passed, $failures;

    if ($condition) {
        $passed++;
    } else {
        $failures[] = $name;
    }
}

$valid = new License(License::PREFIX.str_repeat('a1b2', 8));

check('a well formed key is valid', $valid->valid());
check('a valid key says nothing', $valid->notice() === null);

check('no key is not valid', ! (new License())->valid());
check('no key is not present', ! (new License())->present());
check('no key says it is unlicensed', str_contains((string) (new License())->notice(), 'Unlicensed'));
check('and says reports still work', str_contains((string) (new License())->notice(), 'in full'));

$wrong = new License('sk_live_not_ours');
check('a key from somewhere else is present but not valid', $wrong->present() && ! $wrong->valid());
check('and is told apart from having none', str_contains((string) $wrong->notice(), 'not in the expected format'));
check('and still says reports are unaffected', str_contains((string) $wrong->notice(), 'unaffected'));

check('the wrong length is refused', ! (new License(License::PREFIX.'abc'))->valid());
check('non hex is refused', ! (new License(License::PREFIX.str_repeat('z', 32)))->valid());
check('an empty string counts as no key', ! (new License(''))->present());

// The property that matters most, asserted against the file rather than the
// behaviour: there is nothing here that could reach the network, so there is
// no configuration under which it does.
$source = (string) file_get_contents(__DIR__.'/../src/License.php');
foreach (['curl_', 'file_get_contents(', 'fopen(', 'fsockopen', 'stream_context', 'Http::'] as $call) {
    check("the licence never calls {$call}", ! str_contains($source, $call));
}

echo "\n";

foreach ($failures as $failure) {
    echo "  FAIL  {$failure}\n";
}

printf("\n %d pass, %d fail\n\n", $passed, count($failures));

exit($failures === [] ? 0 : 1);
