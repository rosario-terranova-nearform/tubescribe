import { BotForm } from '@/components/BotForm.tsx';

export function BotNewPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New bot</h1>
      <BotForm />
    </section>
  );
}
