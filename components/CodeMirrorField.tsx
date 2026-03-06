'use client'

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as editorPlaceholder } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { yCollab } from 'y-codemirror.next'
import type * as Y from 'yjs'

type CodeMirrorFieldProps = {
  value: string
  minRows?: number
  placeholder?: string
  busy?: boolean
  readOnly?: boolean
  markdownMode?: boolean
  yText?: Y.Text | null
  onInput?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onActivity?: () => void
}

const createClassName = (busy: boolean): string => (busy ? 'code-field busy' : 'code-field')

export default function CodeMirrorField({
  value,
  minRows = 3,
  placeholder = '',
  busy = false,
  readOnly = false,
  markdownMode = false,
  yText = null,
  onInput,
  onFocus,
  onBlur,
  onActivity,
}: CodeMirrorFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const applyingExternalRef = useRef(false)

  const placeholderCompartmentRef = useRef(new Compartment())
  const languageCompartmentRef = useRef(new Compartment())
  const collabCompartmentRef = useRef(new Compartment())
  const editableCompartmentRef = useRef(new Compartment())

  const placeholderExtension = (): Extension => (placeholder ? editorPlaceholder(placeholder) : [])
  const languageExtension = (): Extension => (markdownMode ? markdown() : [])
  const collabExtension = (): Extension => (yText ? yCollab(yText, undefined) : [])
  const editableExtension = (): Extension => EditorState.readOnly.of(readOnly)

  useEffect(() => {
    if (!rootRef.current) {
      return
    }

    const view = new EditorView({
      parent: rootRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholderCompartmentRef.current.of(placeholderExtension()),
          languageCompartmentRef.current.of(languageExtension()),
          collabCompartmentRef.current.of(collabExtension()),
          editableCompartmentRef.current.of(editableExtension()),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onActivity?.()
            }

            if (!update.docChanged || applyingExternalRef.current || yText) {
              return
            }

            onInput?.(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            focus: () => {
              onFocus?.()
              onActivity?.()
              return false
            },
            blur: () => {
              onBlur?.()
              return false
            },
            keydown: () => {
              onActivity?.()
              return false
            },
            mousedown: () => {
              onActivity?.()
              return false
            },
            click: () => {
              onActivity?.()
              return false
            },
          }),
        ],
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    if (!yText) {
      const currentValue = view.state.doc.toString()
      if (currentValue !== value) {
        applyingExternalRef.current = true
        view.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
        })
        applyingExternalRef.current = false
      }
    }

    view.dispatch({ effects: placeholderCompartmentRef.current.reconfigure(placeholderExtension()) })
    view.dispatch({ effects: languageCompartmentRef.current.reconfigure(languageExtension()) })
    view.dispatch({ effects: collabCompartmentRef.current.reconfigure(collabExtension()) })
    view.dispatch({ effects: editableCompartmentRef.current.reconfigure(editableExtension()) })
  }, [value, placeholder, markdownMode, readOnly, yText])

  return (
    <div
      ref={rootRef}
      className={createClassName(busy)}
      style={{ ['--cm-min-rows' as string]: String(Math.max(1, Math.floor(minRows))) }}
    />
  )
}
