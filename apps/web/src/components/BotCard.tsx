import { useDeleteBot } from '@/api/bots.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import type { Bot } from '@tubescribe/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';

/** One bot in the /bots list: name, model, source count, chat/edit links, delete. */
export function BotCard({ bot }: { bot: Bot }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteBot = useDeleteBot(bot.id);

  const onDelete = () =>
    deleteBot.mutate(undefined, {
      onSuccess: () => {
        setDeleteOpen(false);
        toast.success('Bot deleted');
      },
      onError: (err) => toast.error(err.message),
    });

  return (
    <>
      <Card className="flex-row items-center gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/bots/${bot.id}`} className="truncate font-medium hover:underline">
              {bot.name}
            </Link>
            <Badge variant="secondary">{bot.modelOverride ?? 'default model'}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {bot.sourceIds.length} source{bot.sourceIds.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/bots/${bot.id}`}>Chat</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/bots/${bot.id}/edit`}>Edit</Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteBot.isPending}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete bot?</DialogTitle>
            <DialogDescription>
              Permanently deletes "{bot.name}" and its chat history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteBot.isPending}>
              {deleteBot.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
