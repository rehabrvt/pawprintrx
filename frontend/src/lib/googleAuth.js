// Thin wrapper around Google Identity Services (GIS) for "Sign in with Google".
// The GIS script is loaded in public/index.html. This renders the real Google
// button into a container div and calls onCredential(idToken) once the user
// completes sign-in. Requires REACT_APP_GOOGLE_CLIENT_ID to be set at build time.

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

export function isGoogleSignInConfigured() {
  return Boolean(CLIENT_ID);
}

// Polls briefly for window.google (the GIS script loads async/defer) then
// renders the button. Safe to call multiple times; each call targets its own
// container element.
export function renderGoogleButton(containerId, onCredential, options = {}) {
  if (!CLIENT_ID) return;

  const tryRender = (attemptsLeft) => {
    if (window.google?.accounts?.id) {
      const container = document.getElementById(containerId);
      if (!container) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(container, {
        theme: "outline",
        size: "large",
        width: container.offsetWidth || 320,
        shape: "pill",
        ...options,
      });
      return;
    }
    if (attemptsLeft > 0) {
      setTimeout(() => tryRender(attemptsLeft - 1), 200);
    }
  };

  tryRender(25); // ~5 seconds
}
