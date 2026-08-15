<?php

declare(strict_types=1);

/**
 * A fake ingest, for proving the real sender talks HTTP correctly.
 *
 * Run by tests/run.php through `php -S`. It records what it received to a file
 * so the test can assert on the header name and the body shape, which is
 * exactly what a fake sender would agree with wrongly.
 */
$body = file_get_contents('php://input');
$key = $_SERVER['HTTP_X_REPORTSHQ_KEY'] ?? '';
$status = (int) ($_GET['status'] ?? 201);

file_put_contents(
    sys_get_temp_dir().'/reportshq-fake-ingest.json',
    json_encode(['key' => $key, 'body' => json_decode($body, true)], JSON_UNESCAPED_SLASHES),
);

http_response_code($status);
header('Content-Type: application/json');
echo json_encode(['ok' => $status < 400]);
