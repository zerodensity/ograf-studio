import logoUrl from '../assets/ebu-ograf-logo-mono-white.svg';
import './OgrafLogo.css';

/** Official EBU OGraf wordmark, bundled locally; attribution is in docs/THIRD_PARTY.md. */
export function OgrafLogo({ section = false }: { section?: boolean }) {
  return (
    <img
      className={`ograf-logo${section ? ' ograf-logo-section' : ''}`}
      src={logoUrl}
      alt=""
      aria-hidden="true"
      title="EBU OGraf"
      draggable={false}
      width={section ? 66 : 54}
      height={section ? 22 : 18}
    />
  );
}
