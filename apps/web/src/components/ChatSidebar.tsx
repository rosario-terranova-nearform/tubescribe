import { useChats, useCreateChat, useDeleteChat } from '@/api/chats.ts';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/utils.ts';
import type { Chat } from '@tubescribe/shared';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface ChatSidebarProps {
  botId: string;
  activeChatId: string | null;
  /** Called when a chat is selected (or the active one was deleted → null). */
  onSelectChat: (chatId: string | null) => void;
}

/** Chats for a bot (newest first) with new-chat + delete; selecting one loads it. */
export function ChatSidebar({ botId, activeChatId, onSelectChat }: ChatSidebarProps) {
  const chatsQuery = useChats(botId);
  const createChat = useCreateChat(botId);
  const deleteChat = useDeleteChat(botId);
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);

  const onNewChat = () =>
    createChat.mutate(
      {},
      {
        onSuccess: ({ chat }) => onSelectChat(chat.id),
        onError: (err) => toast.error(err.message),
      },
    );

  const onDelete = () => {
    if (!deleteTarget) return;
    deleteChat.mutate(deleteTarget.id, {
      onSuccess: () => {
        if (deleteTarget.id === activeChatId) onSelectChat(null);
        setDeleteTarget(null);
        toast.success('Chat deleted');
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <aside className="flex w-full flex-col gap-3 md:w-64 md:shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={onNewChat}
        disabled={createChat.isPending}
      >
        <MessageSquarePlus className="size-4" />
        New chat
      </Button>
      {chatsQuery.isPending && <p className="text-sm text-muted-foreground">Loading chats…</p>}
      {chatsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load chats: {chatsQuery.error.message}
        </p>
      )}
      <nav aria-label="Chats" className="flex flex-col gap-1">
        {chatsQuery.data?.chats.map((chat) => (
          <div
            key={chat.id}
            className={cn(
              'group flex items-center gap-1 rounded-md text-sm transition-colors',
              chat.id === activeChatId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
            )}
          >
            <button
              type="button"
              onClick={() => onSelectChat(chat.id)}
              className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left"
            >
              <span className="block truncate">{chat.title}</span>
              <span className="block text-xs text-muted-foreground">
                {new Date(chat.updatedAt).toLocaleString()}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Delete chat ${chat.title}`}
              onClick={() => setDeleteTarget(chat)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </nav>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              Permanently deletes "{deleteTarget?.title}" and its messages. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteChat.isPending}>
              {deleteChat.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
