/**
 * Blocks explaining themselves.
 *
 * These read like copy tests, and they are the ones that stop a number being
 * quoted in a meeting having meant something else. A description that is subtly
 * wrong is worse than none: it is a confident answer to "can I trust this",
 * which is exactly the question somebody is asking when they open it.
 */
import { describe, expect, test } from 'bun:test'
import { describeCaveat, describeQuery } from '../../app/Reports/describe'

describe('describeQuery', () => {
  test('a plain count reads as a sentence, not a query', () => {
    expect(describeQuery({ events: ['commerce.order.created'], measure: 'count', filters: [] }))
      .toBe('The number of events from order placed.')
  })

  test('a sum names the field it is adding up', () => {
    expect(describeQuery({ events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [] }))
      .toBe('The total value from order placed.')
  })

  test('no events means every event, said plainly', () => {
    expect(describeQuery({ events: [], measure: 'count', filters: [] }))
      .toContain('every event')
  })

  test('several events are listed with an and', () => {
    const sentence = describeQuery({
      events: ['user.registered', 'user.login'],
      measure: 'count',
      filters: [],
    })

    expect(sentence).toContain('signed up and signed in')
  })

  test('filters are spelled out in the builder\'s own words', () => {
    const sentence = describeQuery({
      events: ['commerce.order.created'],
      measure: 'count',
      filters: [{ field: 'properties.plan', operator: 'is', value: 'pro' }],
    })

    expect(sentence).toContain('where plan is pro')
  })

  test('a presence filter does not trail an empty value', () => {
    const sentence = describeQuery({
      events: [],
      measure: 'count',
      filters: [{ field: 'currency', operator: 'exists' }],
    })

    expect(sentence).toContain('where currency is present')
    expect(sentence).not.toContain('present .')
  })

  test('several filters join with and', () => {
    const sentence = describeQuery({
      events: [],
      measure: 'count',
      filters: [
        { field: 'properties.plan', operator: 'is', value: 'pro' },
        { field: 'value', operator: 'gt', value: 100 },
      ],
    })

    expect(sentence).toContain('plan is pro and value is greater than 100')
  })

  test('a dimension, a grain and a comparison all appear', () => {
    const sentence = describeQuery({
      events: ['commerce.order.created'],
      measure: 'sum',
      field: 'value',
      dimension: 'properties.plan',
      grain: 'day',
      compare: true,
      filters: [],
    })

    expect(sentence).toContain('split by plan')
    expect(sentence).toContain('daily')
    expect(sentence).toContain('compared with the period before')
  })

  test('a funnel is described as a funnel, not as a measure', () => {
    // A sentence about measures and grains would describe the wrong thing
    // entirely for a block that asks about progression.
    const sentence = describeQuery({
      events: [],
      measure: 'count',
      filters: [],
      steps: ['commerce.product.viewed', 'commerce.checkout.started', 'commerce.order.created'],
    })

    expect(sentence).toContain('How many people who did product viewed')
    expect(sentence).toContain('went on to checkout started, then order placed')
  })

  test('unique counts say people, not rows', () => {
    expect(describeQuery({ events: ['user.login'], measure: 'count_unique', filters: [] }))
      .toContain('distinct users')
  })

  test('a missing or malformed query says so rather than inventing a sentence', () => {
    expect(describeQuery(null)).toContain('does not read any events')
    expect(describeQuery(undefined)).toContain('does not read any events')
  })

  test('every description is one capitalised sentence', () => {
    const queries = [
      { events: [], measure: 'count' as const, filters: [] },
      { events: ['user.login'], measure: 'count_unique' as const, filters: [] },
      { events: ['commerce.order.created'], measure: 'avg' as const, field: 'value', filters: [] },
    ]

    for (const query of queries) {
      const sentence = describeQuery(query)
      expect(sentence.endsWith('.')).toBeTrue()
      expect(sentence[0]).toBe(sentence[0]!.toUpperCase())
    }
  })
})

describe('describeCaveat', () => {
  test('a unique count warns about the user key it depends on', () => {
    expect(describeCaveat({ events: [], measure: 'count_unique', filters: [] }))
      .toContain('stable user key')
  })

  test('a bounded dimension says what happened to the rest', () => {
    expect(describeCaveat({ events: [], measure: 'count', dimension: 'properties.plan', limit: 4, filters: [] }))
      .toContain('top 4')
  })

  test('an ordinary block carries no note at all', () => {
    // A caveat on every block is a caveat nobody reads.
    expect(describeCaveat({ events: ['commerce.order.created'], measure: 'sum', field: 'value', filters: [] })).toBe('')
  })
})
