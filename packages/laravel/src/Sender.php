<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel;

/**
 * The HTTP call itself.
 *
 * Separated so the transport can be tested without a network, and so the
 * package depends on Laravel's HTTP client when it is there without requiring
 * it when it is not. A console script or a test harness gets a working sender
 * with no framework at all.
 */
final class Sender
{
    /**
     * The sender an application gets by default.
     *
     * Laravel's HTTP client when available, since an application will already
     * have its logging, timeouts and fakes wired through it. A plain stream
     * context otherwise, which is enough to deliver a JSON body and read a
     * status code.
     *
     * @return callable(string, string, array<string, mixed>): int
     */
    public static function default(): callable
    {
        if (class_exists(\Illuminate\Support\Facades\Http::class)) {
            return static function (string $endpoint, string $key, array $body): int {
                $response = \Illuminate\Support\Facades\Http::withHeaders([
                    'X-ReportsHQ-Key' => $key,
                    'Content-Type' => 'application/json',
                ])->timeout(5)->post($endpoint, $body);

                return $response->status();
            };
        }

        return self::stream();
    }

    /**
     * A dependency-free sender.
     *
     * @return callable(string, string, array<string, mixed>): int
     */
    public static function stream(): callable
    {
        return static function (string $endpoint, string $key, array $body): int {
            $context = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => "Content-Type: application/json\r\nX-ReportsHQ-Key: {$key}\r\n",
                    'content' => json_encode($body, JSON_UNESCAPED_SLASHES),
                    'timeout' => 5,
                    // Read the body on a 4xx rather than emitting a warning and
                    // returning false, so the status code is available to
                    // decide whether retrying is worth it.
                    'ignore_errors' => true,
                ],
            ]);

            $result = @file_get_contents($endpoint, false, $context);

            if ($result === false && ! isset($http_response_header)) {
                return 0;
            }

            foreach ($http_response_header ?? [] as $header) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $matches) === 1) {
                    return (int) $matches[1];
                }
            }

            return 0;
        };
    }
}
