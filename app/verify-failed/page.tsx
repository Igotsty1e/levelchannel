// Minimal placeholder per /plan-eng-review mech-2. Phase 2 owns the full
// styled UI; this exists in Phase 1B so verify route has a non-dead-end
// redirect target.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ссылка недействительна — LevelChannel',
}

export default function VerifyFailedPage() {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        color: '#0B0B0C',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px' }}>
        Ссылка недействительна
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: '#5F5F67', maxWidth: 480 }}>
        Эта ссылка истекла, уже использована или повреждена.
        Попробуйте перезапросить подтверждение или войти, если e-mail уже подтверждён.
      </p>
    </main>
  )
}
