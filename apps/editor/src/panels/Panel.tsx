import type { CSSProperties, PropsWithChildren } from 'react';
import './Panel.css';

interface PanelProps {
  title: string;
  style?: CSSProperties;
}

export function Panel({ title, style, children }: PropsWithChildren<PanelProps>) {
  return (
    <section className="panel" style={style}>
      <h2 className="panel-title">{title}</h2>
      <div className="panel-body">{children}</div>
    </section>
  );
}
