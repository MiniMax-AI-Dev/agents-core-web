import ReactMarkdown from "react-markdown";

export function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown components={{ h1: ({ children }) => <h2>{children}</h2> }}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
