import { headers } from 'next/headers'
import Link from 'next/link'

// Codex review 2026-05-09 — own 404 page so the framework doesn't fall
// back to its built-in `_not-found` bundle, which contains an inline
// `<style dangerouslySetInnerHTML>` that conflicts with our strict
// `style-src 'self'` CSP. Under the framework default, a user hitting
// any unknown URL would see a broken layout (the 404 markup loads but
// the inline styles get refused by the browser).
//
// We also call `(await headers()).get('x-nonce')` mirroring the trigger
// in `app/layout.tsx` — the read forces dynamic-render mode which keeps
// the nonce auto-stamping pipeline active for the 404 surface, same as
// every other page.

export default async function NotFound() {
  // Side-effect read; nonce is unused but the call is the trigger.
  void (await headers()).get('x-nonce')

  return (
    <main className="not-found-page">
      <div className="not-found-card">
        <h1>404 — страница не найдена</h1>
        <p>
          Похоже, такой страницы у нас нет. Возможно, ссылка устарела или
          была введена с ошибкой.
        </p>
        <Link href="/" className="not-found-back">
          ← На главную
        </Link>
      </div>
    </main>
  )
}
