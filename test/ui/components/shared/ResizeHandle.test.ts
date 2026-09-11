// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ResizeHandle from '../../../../src/components/shared/ResizeHandle.tsx'

afterEach(cleanup)

test('resize separator reports controlled height on first paint and applies bounded keyboard changes', () => {
  const onHeight = vi.fn()
  const props = { targetRef: { current: null }, onHeight, min: 160, max: 1200, height: 320 }
  const { rerender } = render(createElement(ResizeHandle, props))
  const separator = screen.getByRole('separator')
  expect(separator.getAttribute('aria-valuenow')).toBe('320')
  fireEvent.keyDown(separator, { key: 'ArrowUp' })
  expect(onHeight).toHaveBeenLastCalledWith(330)
  rerender(createElement(ResizeHandle, { ...props, height: 330 }))
  expect(separator.getAttribute('aria-valuenow')).toBe('330')
  rerender(createElement(ResizeHandle, { ...props, height: 160 }))
  fireEvent.keyDown(separator, { key: 'ArrowDown' })
  expect(onHeight).toHaveBeenLastCalledWith(160)
  rerender(createElement(ResizeHandle, { ...props, height: 1200 }))
  fireEvent.keyDown(separator, { key: 'ArrowUp' })
  expect(onHeight).toHaveBeenLastCalledWith(1200)
})
