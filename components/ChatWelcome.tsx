import QuietMark from './QuietMark';

export default function ChatWelcome({ title }: { title: string }) {
  return <div className="my-auto flex flex-col items-center py-12 text-center sm:py-16">
    <QuietMark />
    <h2 className="mt-5 text-[24px] font-medium tracking-tight sm:text-[28px]">{title}</h2>
    <p className="mt-3 text-sm text-muted">שאלה, רעיון או משהו ליצור.</p>
  </div>;
}
