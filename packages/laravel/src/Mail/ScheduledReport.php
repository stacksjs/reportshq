<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use ReportsHQ\Laravel\Reports\Export;
use ReportsHQ\Laravel\Reports\Report;

/**
 * A report, in somebody's inbox.
 *
 * The headline numbers in the body and the detail as an attachment, which is
 * the shape people actually use: the email answers "is anything wrong" on a
 * phone, and the attachment answers "what exactly" at a desk.
 *
 * Queued, because rendering a report runs every block and an application's mail
 * driver should not be holding a connection open while a database aggregates a
 * month of orders.
 */
class ScheduledReport extends Mailable
{
    use Queueable;
    use SerializesModels;

    /**
     * @param  list<array<string, mixed>>  $blocks
     */
    public function __construct(
        public Report $report,
        public array $blocks,
        public ?string $format = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->report->name);
    }

    public function content(): Content
    {
        // `markdown`, not `view`. The template uses `<x-mail::message>`, which
        // is a markdown mail component: rendered as plain Blade the `mail::`
        // hint is not registered and the whole mailable throws.
        return new Content(markdown: 'reportshq::mail.report');
    }

    /** @return array<int, Attachment> */
    public function attachments(): array
    {
        if ($this->format === null) {
            return [];
        }

        $bytes = $this->format === 'csv' ? Export::csv($this->blocks) : Export::xlsx($this->blocks);

        return [
            Attachment::fromData(
                fn (): string => $bytes,
                Export::filename($this->report->name, $this->format),
            ),
        ];
    }
}
