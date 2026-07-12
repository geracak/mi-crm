// Stub estático, sin lógica de autenticación. GER-217 implementa el login
// real (validación, sesión, recupero de contraseña); esta página solo existe
// como destino de navegación para que el shell de GER-33 no apunte a un 404.
export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-primary font-semibold text-on-primary">
            V
          </span>
          <span className="font-semibold text-text">Vibe CRM</span>
        </div>
        <h1 className="mb-1 text-xl font-semibold text-text">Inicia sesión</h1>
        <p className="text-sm text-text-muted">
          El formulario de login todavía no está implementado (GER-217).
        </p>
      </div>
    </div>
  );
}
