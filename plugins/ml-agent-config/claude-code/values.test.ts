import { expect, test } from 'bun:test'
import type { Setting } from '../types'
import { targetLayer } from './values'

const CHAIN = ['global', 'context:acme', 'context:acme:me', 'context:acme-web', 'context:acme-web:me', 'repo', 'user-repo', 'local']

function key(over: Partial<Setting>): Setting {
  return { path: 'x', description: '', layer: null, default: null, value: null, source: null, credential: false, personal: false, required: false, schema: null, levels: {}, ...over }
}

test('a key declared for a context opens at the innermost context, at its team file', () => {
  expect(targetLayer(key({ layer: 'context' }), CHAIN)).toBe('context:acme-web')
})

test('a personal context key opens at the innermost context, at its me file', () => {
  expect(targetLayer(key({ layer: 'context', personal: true }), CHAIN)).toBe('context:acme-web:me')
})

test('a credential declared for a context opens at the innermost context, at its me file', () => {
  expect(targetLayer(key({ layer: 'context', credential: true }), CHAIN)).toBe('context:acme-web:me')
})

test('with no context here, a context key opens at global', () => {
  expect(targetLayer(key({ layer: 'context' }), ['global', 'repo', 'user-repo', 'local'])).toBe('global')
})

test('where the value is set now wins over the context', () => {
  expect(targetLayer(key({ layer: 'context', source: 'context:acme' }), CHAIN)).toBe('context:acme')
  expect(targetLayer(key({ layer: 'context', personal: true, source: 'local' }), CHAIN)).toBe('local')
})
