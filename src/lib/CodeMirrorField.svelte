<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
  import { markdown } from '@codemirror/lang-markdown'
  import { Compartment, EditorState, type Extension } from '@codemirror/state'
  import { EditorView, keymap, placeholder as editorPlaceholder } from '@codemirror/view'
  import { yCollab } from 'y-codemirror.next'
  import type * as Y from 'yjs'

  const dispatch = createEventDispatcher<{
    input: string
    focus: void
    blur: void
  }>()

  export let value = ''
  export let minRows = 3
  export let placeholder = ''
  export let busy = false
  export let markdownMode = false
  export let yText: Y.Text | null = null

  let rootElement: HTMLDivElement | null = null
  let view: EditorView | null = null
  let isApplyingExternalValue = false

  const placeholderCompartment = new Compartment()
  const languageCompartment = new Compartment()
  const collabCompartment = new Compartment()

  const placeholderExtension = (): Extension => (placeholder ? editorPlaceholder(placeholder) : [])

  const languageExtension = (): Extension => (markdownMode ? markdown() : [])

  const collabExtension = (): Extension => (yText ? yCollab(yText, undefined) : [])

  const setDocumentValue = (nextValue: string): void => {
    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()
    if (currentValue === nextValue) {
      return
    }

    isApplyingExternalValue = true
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: nextValue,
      },
    })
    isApplyingExternalValue = false
  }

  onMount(() => {
    if (!rootElement) {
      return
    }

    view = new EditorView({
      parent: rootElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholderCompartment.of(placeholderExtension()),
          languageCompartment.of(languageExtension()),
          collabCompartment.of(collabExtension()),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || isApplyingExternalValue || yText) {
              return
            }

            dispatch('input', update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            focus: () => {
              dispatch('focus')
              return false
            },
            blur: () => {
              dispatch('blur')
              return false
            },
          }),
        ],
      }),
    })
  })

  onDestroy(() => {
    view?.destroy()
    view = null
  })

  $: if (!yText) {
    setDocumentValue(value)
  }
  $: if (view) {
    view.dispatch({ effects: placeholderCompartment.reconfigure(placeholderExtension()) })
  }
  $: if (view) {
    view.dispatch({ effects: languageCompartment.reconfigure(languageExtension()) })
  }
  $: if (view) {
    view.dispatch({ effects: collabCompartment.reconfigure(collabExtension()) })
  }
</script>

<div class="code-field" class:busy style={`--cm-min-rows: ${Math.max(1, Math.floor(minRows))};`} bind:this={rootElement}></div>

<style>
  .code-field {
    width: 100%;
  }

  .code-field :global(.cm-editor) {
    border: 1px solid #c5d5ea;
    border-radius: 10px;
    background: #ffffff;
  }

  .code-field :global(.cm-editor.cm-focused) {
    outline: 2px solid rgba(70, 125, 197, 0.2);
    border-color: #5c85bf;
  }

  .code-field :global(.cm-gutters) {
    display: none;
  }

  .code-field :global(.cm-scroller) {
    font-family: 'IBM Plex Mono', 'Fira Mono', 'Consolas', monospace;
    line-height: 1.5;
    overflow: hidden;
  }

  .code-field :global(.cm-content),
  .code-field :global(.cm-placeholder) {
    font-size: 0.84rem;
    padding: 0.45rem 0.55rem;
  }

  .code-field :global(.cm-content) {
    min-height: calc(var(--cm-min-rows) * 1.3rem);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .code-field.busy :global(.cm-editor) {
    border-color: #d7b07a;
    background: #fff5e8;
  }
</style>
