# Frontend framework fit for Scrummr

Research date: 2026-07-31

## Question and constraints

This report compares React (both a client application and Next.js), SvelteKit, and Vue 3 as candidates for Scrummr's realtime collaborative frontend. The backend remains Kotlin/Spring and owns the REST/realtime API, authentication and authorization, Jira integration, and durable state. Vercel is an option, not a requirement. The main client is an authenticated, browser-heavy collaboration room with rich-text co-editing, presence, voting, focus/follow behavior, and a stable room link.

This is evidence for a later decision, not the framework decision itself.

## Executive findings

1. **CRDT feasibility does not separate the candidates.** Yjs is network-agnostic and exposes editor bindings independently of the UI framework; its own catalog includes ProseMirror/Tiptap and bindings for React, Vue, and Svelte. Tiptap is likewise framework-agnostic and documents React, Next.js, Vue, Nuxt, and Svelte integrations. ([Yjs repository](https://github.com/yjs/yjs), [Tiptap installation matrix](https://tiptap.dev/docs/editor/getting-started/install))
2. **Integration depth does separate them.** Tiptap supplies React hooks, context, editor-state selectors, React UI components, templates, and a Next.js guide. Its Svelte guide instead instantiates `@tiptap/core` in `onMount`, destroys it manually, and forces a Svelte update from `onTransaction`. Vue has a dedicated `@tiptap/vue-3` integration, but the documented ready-made Tiptap UI components and templates are React-oriented. ([React integration](https://tiptap.dev/docs/editor/getting-started/install/react), [Svelte integration](https://tiptap.dev/docs/editor/getting-started/install/svelte), [Tiptap overview](https://tiptap.dev/docs/editor/getting-started/overview))
3. **React and Next.js are materially different choices.** A React client built with Vite can be a static application with a direct Spring API boundary. Next.js adds Server Components, server/client module boundaries, a Node-capable frontend runtime, and server-side features. Next.js can also run as an SPA/static export, but then server-dependent features are unavailable. ([React project guidance](https://react.dev/learn/creating-a-react-app), [Next.js App Router](https://nextjs.org/docs/app), [Next.js deployment modes](https://nextjs.org/docs/app/getting-started/deploying))
4. **SSR is peripheral to the collaboration room.** Next.js says interactive code using state, events, and browser APIs is client code; Tiptap's Next.js guide marks the editor `use client` and delays editor creation until after hydration to avoid SSR mismatch. The active room therefore receives little benefit from server-rendering its core editor/realtime surface. Public pages, login, organization administration, and the inactive-room shell may still benefit from prerendering or SSR. ([Next.js client boundary](https://nextjs.org/docs/app/api-reference/directives/use-client), [Tiptap with Next.js](https://tiptap.dev/docs/editor/getting-started/install/nextjs))
5. **Testing and deployment are viable across the shortlist.** React, Svelte, and Vue all have documented component/unit-test paths, and Playwright is framework-independent for multi-browser end-to-end tests. Vite produces static `dist` assets deployable to any static host; SvelteKit supports static, standalone Node, and Vercel adapters; Next.js supports Node, Docker, static export, and adapters, with feature differences between modes. ([React testing](https://react.dev/reference/react/act), [Svelte testing](https://svelte.dev/docs/svelte/testing), [Vue testing](https://vuejs.org/guide/scaling-up/testing.html), [Playwright](https://playwright.dev/docs/intro), [Vite static deployment](https://vite.dev/guide/static-deploy.html), [SvelteKit adapters](https://svelte.dev/packages), [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying))

## The collaboration/editor substrate

Yjs shared types synchronize observable maps, arrays, text, and XML structures through separately chosen providers. Its ProseMirror binding supports shared editing, cursors, shared undo/redo, and versions; Tiptap is built on ProseMirror and integrates Yjs through its collaboration extension. This makes editor model and transport a separate architectural decision from component framework. ([Yjs shared types](https://docs.yjs.dev/getting-started/working-with-shared-types), [Yjs ProseMirror binding](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror), [Tiptap collaboration setup](https://tiptap.dev/docs/collaboration/getting-started/install))

That separation matters for Scrummr: the Spring backend could authenticate a WebSocket/provider and checkpoint Yjs updates without adopting a JavaScript application server. The source evidence only proves the client-side/editor substrate is framework-independent; it does **not** prove that any available Yjs server is suitable for Spring, nor that Yjs should carry votes, host leases, or scalar Jira fields. Those belong to the realtime architecture decision.

### React-specific editor breadth

React has at least three first-party-documented routes:

- Tiptap provides `@tiptap/react`, hooks for editor creation and selected editor state, context APIs, and React-oriented ready-made components/templates. ([Tiptap React guide](https://tiptap.dev/docs/editor/getting-started/install/react), [Tiptap overview](https://tiptap.dev/docs/editor/getting-started/overview))
- BlockNote describes itself as a React block editor with ready-to-use UI and realtime collaboration/Yjs support. It is higher level and more opinionated than bare Tiptap. ([BlockNote introduction](https://www.blocknotejs.org/docs), [BlockNote React API](https://www.blocknotejs.org/docs/react/overview), [BlockNote editor API](https://www.blocknotejs.org/docs/reference/editor/overview))
- Lexical's maintained repository includes React bindings and Yjs-based collaborative editing. ([Lexical repository](https://github.com/facebook/lexical))

This breadth lowers the risk that the first editor choice becomes the frontend framework choice. It also creates more evaluation work: editor schema compatibility with Jira fields, HTML/ADF conversion, licensing, accessibility, and controlled finalization semantics still need separate validation.

### Svelte-specific editor fit

Tiptap officially documents SvelteKit and current Svelte runes, so Svelte is not dependent on an unofficial editor port. However, the official example directly owns the editor lifecycle and uses an `onTransaction` assignment to trigger UI updates, whereas React gets a dedicated binding package and state-selection hook. ([Tiptap Svelte guide](https://tiptap.dev/docs/editor/getting-started/install/svelte), [Tiptap React guide](https://tiptap.dev/docs/editor/getting-started/install/react))

This is an integration-maintenance signal, not evidence that Svelte cannot support the editor. A prototype should measure how much adapter code is required for toolbar state, remote cursors, teardown/reconnect, read-only transitions, and component tests.

### Vue as the serious alternative

Vue 3 is worth keeping in the comparison because Tiptap documents Vue/Nuxt as supported targets and maintains a dedicated `@tiptap/vue-3` package; TanStack Query also maintains a Vue adapter. Vue's core team maintains Pinia as the recommended store for large applications, with TypeScript inference and devtools support. ([Tiptap installation matrix](https://tiptap.dev/docs/editor/getting-started/install), [`@tiptap/vue-3` changelog](https://tiptap.dev/docs/resources/changelog/vue-3), [TanStack Query frameworks](https://tanstack.com/query/latest/docs/framework), [Vue state management](https://vuejs.org/guide/scaling-up/state-management.html))

Vue therefore has credible editor, server-state, application-state, and testing paths. Nothing found establishes a Scrummr-specific advantage over React or SvelteKit, so adding it to a hands-on prototype should be justified by developer ergonomics rather than abstract completeness.

## Complex client state

Scrummr will have several distinct forms of state: REST resources, realtime server-authoritative session state, CRDT editor state, transient presence, local UI state, and remembered display-name preferences. These should not be collapsed into one framework store.

- React has a built-in `useSyncExternalStore` contract specifically for subscribing to external mutable stores and browser APIs. Redux Toolkit is the Redux maintainers' recommended approach for predictable global state, and the official Redux docs identify frequently changing, complex shared state as a fitting use case. ([React external stores](https://react.dev/reference/react/useSyncExternalStore), [Redux Toolkit guidance](https://redux.js.org/introduction/why-rtk-is-redux-today), [Redux usage criteria](https://redux.js.org/tutorials/fundamentals/part-1-overview))
- Svelte 5 provides universal reactive state through runes, while SvelteKit documents state-management conventions. TanStack Query has an official Svelte adapter, so server-resource caching is not missing. ([Svelte runes](https://svelte.dev/docs/svelte/what-are-runes), [SvelteKit state management](https://svelte.dev/docs/kit/state-management), [TanStack Query frameworks](https://tanstack.com/query/latest/docs/framework))
- Vue's reactivity can live outside components; its docs recommend Pinia when conventions, devtools, HMR, SSR, and team-scale maintainability become important. TanStack Query has an official Vue adapter. ([Vue state management](https://vuejs.org/guide/scaling-up/state-management.html), [TanStack Query frameworks](https://tanstack.com/query/latest/docs/framework))

The framework decision should require an explicit state-ownership sketch. In particular, the CRDT/editor instance should remain authoritative for collaborative text, while server messages remain authoritative for host/focus/session lifecycle. Mirroring either into a general UI store risks two sources of truth regardless of framework.

## React client versus Next.js

### Plain React with Vite (or a thin React router)

React's own guidance recommends a framework for new applications but explicitly allows a from-scratch build with Vite when established frameworks do not fit the constraints. It notes that this route requires choosing routing, data fetching, and other common tools. ([React project guidance](https://react.dev/learn/creating-a-react-app))

For Scrummr, that trade is unusually relevant: Spring already supplies the backend, and the room is primarily a client-side realtime application. A Vite React build yields static assets, can call Spring over REST/WebSocket, and does not introduce a second server runtime. Vite documents that its default `dist` output can be deployed to any chosen static host. ([Vite static deployment](https://vite.dev/guide/static-deploy.html))

The cost is assembly and governance: routing, data fetching, state boundaries, auth redirects, error handling, and conventions must be selected and documented rather than inherited from a full-stack framework.

### Next.js

Next.js's App Router is built around Server Components, Suspense, and Server Functions. Interactive room components still cross into the client graph with `use client`; everything imported below that boundary joins the client bundle. ([Next.js App Router](https://nextjs.org/docs/app), [server/client components](https://nextjs.org/docs/app/getting-started/server-and-client-components))

Next.js does not force Vercel: official deployment modes include a Node server, Docker, static export, and platform adapters. The modes are not equivalent—Node/Docker support all features, static export has limited support, and adapter support varies. ([Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying))

For a strict Spring boundary, Next.js has two coherent shapes:

1. use Next.js as a static/SPA React delivery framework and call Spring directly; or
2. deliberately introduce a frontend BFF for selected concerns.

The second shape is an additional architectural component, not a free frontend detail. Next.js itself describes Route Handlers as public HTTP endpoints and says its backend capabilities are not a full backend replacement. ([Next.js backend-for-frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend))

Testing also carries one Next-specific caveat: its testing guide supports Cypress, Jest, Playwright, and Vitest, but recommends end-to-end tests rather than unit tests for async Server Components because tool support is incomplete. ([Next.js testing](https://nextjs.org/docs/app/guides/testing))

## SvelteKit

SvelteKit can be deployed as prerendered/static output, a standalone Node server, or through an official Vercel adapter. It can also be configured as a client-rendered SPA, though its own docs warn of startup-performance and SEO costs and recommend prerendering where possible. ([SvelteKit static adapter](https://svelte.dev/docs/kit/adapter-static), [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node), [SvelteKit Vercel adapter](https://svelte.dev/docs/kit/adapter-vercel), [SvelteKit SPA mode](https://svelte.dev/docs/kit/single-page-apps))

The framework has an official testing path: the Svelte docs recommend Vitest for Vite/SvelteKit unit and component tests and document Playwright for end-to-end testing. ([Svelte testing](https://svelte.dev/docs/svelte/testing))

SvelteKit therefore preserves the same architectural options as Next.js—static client or frontend server—without depending on Vercel. Its decision risk is less about missing fundamentals and more about the thinner collaboration/editor integration described above, plus the team's willingness to own Svelte-specific knowledge.

## Testing implications for realtime collaboration

Component tooling is adequate in every candidate, but it cannot prove the most important behavior. Host grace periods, takeover, remote cursors, concurrent edits, reconnect, focus following, and guest data removal require at least two independent browser contexts connected to a real or faithful realtime backend.

Playwright supplies a framework-independent test runner, isolated browser contexts, parallel execution, and Chromium/WebKit/Firefox coverage. That makes a multi-client Playwright suite portable across all candidates and should be treated as an architecture requirement rather than a framework differentiator. ([Playwright introduction](https://playwright.dev/docs/intro))

At component level, React Testing Library, Svelte's documented Vitest path, and Vue's documented Vitest/Vue Test Utils path all support user-oriented tests. ([React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), [Svelte testing](https://svelte.dev/docs/svelte/testing), [Vue testing](https://vuejs.org/guide/scaling-up/testing.html))

## Learning and maintainability for a Kotlin-focused developer

Primary documentation cannot establish which component model one Kotlin developer will maintain most effectively. It can expose the learning surface:

- React plus Vite has a small framework core but requires explicit choices for router, resource cache, shared state, and conventions; the payoff is the broadest evidenced editor choice in this investigation.
- Next.js adds the App Router, Server/Client Components, rendering and caching modes, and a possible Node/BFF deployment surface on top of React.
- SvelteKit combines routing and application conventions with Svelte 5's compiler/runes model; the editor boundary presently requires more explicit lifecycle integration.
- Vue 3 combines Composition API, Pinia, Vue Router/Vite or Nuxt, and a dedicated Tiptap binding; adding it means learning a third candidate without an evidenced product-specific advantage yet.

The maintainability claim should therefore be tested, not voted on from syntax samples. A small, time-boxed vertical prototype can measure comprehension, integration code, failure behavior, and test clarity with the same scenario in the leading candidates.

## Deployment portability and the Spring boundary

All shortlisted technologies can preserve a clean API boundary if the frontend is built as static assets and Spring is the only application server:

- Vite builds static output suitable for arbitrary static hosting. ([Vite deployment](https://vite.dev/guide/static-deploy.html))
- SvelteKit's static adapter prerenders to static files; its Node and Vercel adapters remain optional. ([SvelteKit static adapter](https://svelte.dev/docs/kit/adapter-static), [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node), [SvelteKit Vercel adapter](https://svelte.dev/docs/kit/adapter-vercel))
- Next.js static export can be served by any static host, while Node/Docker retain its full feature set. ([Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying))

Using a frontend server may still be justified for SSR, cookie mediation, or a BFF, but it creates a second runtime and an additional authorization/data path. The framework choice should not accidentally make that system-boundary decision.

## Decision-relevant comparison

| Candidate | Strong evidence for Scrummr | Main uncertainty to resolve |
| --- | --- | --- |
| React + Vite/thin router | Dedicated Tiptap integration; alternative collaborative editors such as BlockNote and Lexical; external-store API; mature state/testing choices; simplest static boundary to Spring | More assembly decisions and conventions; whether the team finds React hooks/state semantics maintainable |
| Next.js | Same React editor ecosystem; integrated routing/rendering; Node, Docker, static, and Vercel-capable deployment | Whether SSR/RSC/BFF features justify their concepts and second-runtime risk for a mostly client-side room |
| SvelteKit | Official Tiptap/Svelte path; concise native reactivity; integrated routing; static, Node, and Vercel deployment; documented tests | More hand-written editor lifecycle/state adaptation; depth of collaboration-specific component ecosystem and team support |
| Vue 3 + Vite/Nuxt | Dedicated Tiptap Vue package; Pinia; official query/testing paths; static-client option | No evidenced Scrummr-specific advantage yet; extra candidate learning/prototype cost |

## What the decision ticket should validate

Do not decide from a generic counter application. Build the same narrow spike in the leading candidates:

1. join a room over the intended Spring-facing realtime protocol;
2. mount a Tiptap/Yjs editor with two browser contexts and remote cursors;
3. switch the same ticket between editable and read-only without losing state;
4. reflect server-authoritative focus/presence outside the CRDT;
5. reconnect and tear down without duplicate subscriptions;
6. test one component behavior and one two-browser Playwright scenario;
7. build a portable production artifact and document whether a Node frontend runtime is required.

Measure adapter code, conceptual surface, bundle/runtime behavior, test determinism, and how confidently the Kotlin-focused maintainer can explain the state flow after the spike. The comparison supports shortlisting React (with **Next.js and a client-only React setup evaluated separately**) and SvelteKit. Vue is a credible control candidate if the extra prototype cost is acceptable. It does not support choosing a winner without that evidence.
