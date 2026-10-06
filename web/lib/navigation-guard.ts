type Guard = () => Promise<unknown>;

let guard: Guard | null = null;

/** A page registers work that must finish before the app navigates away, such as saving a draft. */
export function setLeaveGuard(next: Guard | null) {
  guard = next;
}

/** Resolves false when the page could not finish, so navigation should not continue. */
export async function runLeaveGuard() {
  try {
    await guard?.();
    return true;
  } catch {
    return false;
  }
}
