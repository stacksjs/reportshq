<?php

declare(strict_types=1);

namespace ReportsHQ\Laravel\Charts;

/**
 * A block, as a custom element.
 *
 * The charts are stx components, compiled to web components and shipped as a
 * bundle. This is the whole of the PHP side: pick the tag, hand it the block as
 * JSON, and let the component draw.
 *
 * What this replaces is the point of it. Before, the same charts existed twice:
 * once in stx for the hosted product and once in PHP here, with the geometry
 * ported by hand. Two implementations of one curve is a promise to keep them
 * agreeing forever, and the second one is always the one that drifts. Now the
 * component is written once and this file chooses a tag.
 */
final class Elements
{
    /** Block kind to the element the bundle registers. */
    private const TAGS = [
        'big_number' => 'stacks-big-number',
        'line' => 'stacks-line-chart',
        'area' => 'stacks-line-chart',
        'bar' => 'stacks-bar-chart',
        'donut' => 'stacks-donut-chart',
        'table' => 'stacks-table-chart',
        'funnel' => 'stacks-funnel-chart',
        'heatmap' => 'stacks-heatmap-chart',
        'note' => 'stacks-text-block',
    ];

    public static function tag(string $kind): string
    {
        return self::TAGS[$kind] ?? 'stacks-text-block';
    }

    /**
     * The element for one rendered block.
     *
     * The payload rides in an attribute rather than a script tag. An object
     * property deserializes from its attribute, so the element is complete the
     * moment the parser reaches it: no second pass to hydrate, and a block is
     * readable in view-source, which is where somebody looks when a number
     * seems wrong.
     */
    public static function render(array $block): string
    {
        $attributes = ['result' => json_encode($block, JSON_THROW_ON_ERROR)];

        if (($block['title'] ?? '') !== '') {
            $attributes['title'] = (string) $block['title'];
        }

        foreach (['unit', 'currency', 'body'] as $name) {
            if (($block[$name] ?? null) !== null) {
                $attributes[$name] = (string) $block[$name];
            }
        }

        if (($block['invert'] ?? false) === true) {
            $attributes['invert'] = 'true';
        }

        $rendered = '';

        foreach ($attributes as $name => $value) {
            $rendered .= sprintf(' %s="%s"', $name, htmlspecialchars($value, ENT_QUOTES, 'UTF-8'));
        }

        $tag = self::tag((string) ($block['kind'] ?? 'note'));

        return "<{$tag}{$rendered}></{$tag}>";
    }

    /** The bundle, inlined. One request, and no asset pipeline to configure. */
    public static function script(): string
    {
        return (string) file_get_contents(__DIR__.'/../../resources/dist/reportshq.js');
    }

    public static function css(): string
    {
        return Assets::css()."\n".(string) file_get_contents(__DIR__.'/../../resources/dist/reportshq-components.css');
    }
}
