<script lang="ts">
  import { onMount } from 'svelte';
  import { todoApi, type Todo } from '$lib/api';

  let todos: Todo[] = [];
  let title = '';
  let loading = true;
  let saving = false;
  let error = '';

  async function loadTodos() {
    loading = true;
    error = '';

    try {
      todos = await todoApi.list();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load todos';
    } finally {
      loading = false;
    }
  }

  async function createTodo() {
    const nextTitle = title.trim();
    if (!nextTitle || saving) {
      return;
    }

    saving = true;
    error = '';

    try {
      const todo = await todoApi.create(nextTitle);
      todos = [todo, ...todos];
      title = '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create todo';
    } finally {
      saving = false;
    }
  }

  async function toggleTodo(id: number) {
    error = '';

    try {
      const updated = await todoApi.toggle(id);
      todos = todos.map((todo) => (todo.id === id ? updated : todo));
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update todo';
    }
  }

  async function deleteTodo(id: number) {
    error = '';

    try {
      await todoApi.remove(id);
      todos = todos.filter((todo) => todo.id !== id);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete todo';
    }
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    void createTodo();
  }

  onMount(() => {
    void loadTodos();
  });
</script>

<svelte:head>
  <title>Scrummr</title>
  <meta
    name="description"
    content="SvelteKit frontend backed by a Spring Boot API with SQLite persistence."
  />
</svelte:head>

<div class="shell">
  <section class="hero">
    <p class="eyebrow">Scrummr</p>
    <h1>Spring Boot backend + SvelteKit frontend</h1>
    <p class="lede">
      This app now uses a dedicated Java API with SQLite persistence and a separate SvelteKit UI.
    </p>
  </section>

  <section class="panel">
    <form class="composer" on:submit={handleSubmit}>
      <input
        bind:value={title}
        type="text"
        name="title"
        placeholder="Add a task"
        maxlength="255"
        autocomplete="off"
      />
      <button type="submit" disabled={saving}>
        {#if saving}Saving...{:else}Add{/if}
      </button>
    </form>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if loading}
      <p class="empty">Loading todos...</p>
    {:else if todos.length === 0}
      <p class="empty">No todos yet. Add your first one above.</p>
    {:else}
      <ul class="todo-list">
        {#each todos as todo (todo.id)}
          <li class:done={todo.completed}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                on:change={() => void toggleTodo(todo.id)}
              />
              <span>{todo.title}</span>
            </label>
            <button class="ghost" type="button" on:click={() => void deleteTodo(todo.id)}>
              Delete
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background:
      radial-gradient(circle at top, rgba(99, 102, 241, 0.25), transparent 28%),
      linear-gradient(180deg, #0f172a 0%, #111827 100%);
    color: #e5e7eb;
  }

  .shell {
    width: min(880px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 4rem 0;
  }

  .hero {
    margin-bottom: 2rem;
  }

  .eyebrow {
    margin: 0 0 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.78rem;
    color: #a5b4fc;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.25rem, 5vw, 4rem);
    line-height: 1;
  }

  .lede {
    max-width: 48rem;
    margin-top: 1rem;
    color: #cbd5e1;
    font-size: 1.05rem;
  }

  .panel {
    padding: 1.25rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 1.5rem;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(14px);
    box-shadow: 0 20px 60px rgba(15, 23, 42, 0.35);
  }

  .composer {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
  }

  input[type='text'] {
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 999px;
    padding: 0.95rem 1.1rem;
    font: inherit;
    color: inherit;
    background: rgba(15, 23, 42, 0.8);
  }

  button {
    border: none;
    border-radius: 999px;
    padding: 0.95rem 1.25rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    color: #0f172a;
    background: #c7d2fe;
  }

  button:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .ghost {
    color: #e5e7eb;
    background: rgba(148, 163, 184, 0.14);
  }

  .error {
    margin: 1rem 0 0;
    color: #fca5a5;
  }

  .empty {
    margin: 1.25rem 0 0;
    color: #cbd5e1;
  }

  .todo-list {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: grid;
    gap: 0.75rem;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.1rem;
    border-radius: 1rem;
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.14);
  }

  li.done span {
    text-decoration: line-through;
    color: #94a3b8;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  input[type='checkbox'] {
    width: 1rem;
    height: 1rem;
  }

  @media (max-width: 640px) {
    .composer {
      grid-template-columns: 1fr;
    }

    li {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
