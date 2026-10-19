import { chatsQueryKey, useChatMessages } from '@/api/chats.ts';
import { CitationChip } from '@/components/CitationChip.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import {
  type ChatUIMessage,
  NdjsonChatTransport,
  messageText,
  toChatUIMessage,
} from '@/lib/chat.ts';
import { cn } from '@/lib/utils.ts';
import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { SendHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface ChatViewProps {
  botId: string;
  chatId: string;
  /** Shown above the input while the conversation is still empty. */
  emptyState?: ReactNode;
}

/** One chat: loads persisted messages (citations included), then hands off to ChatSession. */
export function ChatView({ botId, chatId, emptyState }: ChatViewProps) {
  const historyQuery = useChatMessages(chatId);

  if (historyQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading chat…</p>;
  }
  if (historyQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load chat: {historyQuery.error.message}
      </p>
    );
  }
  // key remounts the session per chat, so useChat state never leaks across chats.
  return (
    <ChatSession
      key={chatId}
      botId={botId}
      chatId={chatId}
      initialMessages={historyQuery.data.messages.map(toChatUIMessage)}
      emptyState={emptyState}
    />
  );
}

interface ChatSessionProps extends ChatViewProps {
  initialMessages: ChatUIMessage[];
}

function ChatSession({ botId, chatId, initialMessages, emptyState }: ChatSessionProps) {
  const queryClient = useQueryClient();
  const transport = useMemo(() => new NdjsonChatTransport(), []);
  const { messages, sendMessage, status, error } = useChat<ChatUIMessage>({
    id: chatId,
    messages: initialMessages,
    transport,
    // The server bumps the chat's updatedAt once the answer is persisted;
    // refresh the sidebar so ordering/timestamps stay truthful.
    onFinish: () => queryClient.invalidateQueries({ queryKey: chatsQueryKey(botId) }),
  });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = status === 'submitted' || status === 'streaming';

  // Auto-scroll to the newest content as messages grow / stream in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    void sendMessage({ text });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={scrollRef}
        data-testid="message-list"
        className="flex min-h-64 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border bg-background p-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No messages yet — ask anything.</p>
            {emptyState}
          </div>
        )}
        {messages.map((message) => {
          const text = messageText(message);
          const citations = message.metadata?.citations ?? [];
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={cn('flex', isUser && 'justify-end')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  isUser ? 'bg-primary text-primary-foreground' : 'bg-muted/50',
                )}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap">{text}</p>
                ) : (
                  <div className="chat-markdown">
                    <ReactMarkdown>{text}</ReactMarkdown>
                  </div>
                )}
                {citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {citations.map((citation, i) => (
                      <CitationChip
                        key={`${citation.videoId}-${citation.startMs}`}
                        citation={citation}
                        index={i}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {status === 'error' && error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about the corpus…"
          aria-label="Message"
          rows={2}
          disabled={streaming}
          className="min-h-11 resize-none"
        />
        <Button type="submit" disabled={streaming || !input.trim()}>
          <SendHorizontal className="size-4" />
          {streaming ? 'Answering…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
