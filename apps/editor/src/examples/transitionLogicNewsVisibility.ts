/** A prepared mount is only made visible after it has been sampled into the program output. */
export function newsVisibilityGate(
  mount: { ready: Promise<void>; host: { style: { visibility: string } } },
  isCurrent: () => boolean,
  refresh: () => void,
): () => void {
  let ready = false;
  void mount.ready.then(
    () => {
      if (!isCurrent()) return;
      ready = true;
      // A paused replay has no next playback tick, so paint its selected frame now.
      refresh();
    },
    () => {
      // The request's preparation handler reports failures; never reveal a failed mount.
    },
  );
  return () => {
    if (ready && isCurrent()) mount.host.style.visibility = '';
  };
}
