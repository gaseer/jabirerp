import { Card } from "@/components/ui/card";

/** Empty route placeholder — real screens arrive in later slices. */
export function Placeholder({
  icon,
  title,
  slice,
}: {
  icon: string;
  title: string;
  slice: string;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{title}</h2>
      <Card className="flex flex-col items-center gap-2 py-10 text-center text-muted">
        <span className="text-4xl">{icon}</span>
        <p>Coming in {slice}.</p>
      </Card>
    </div>
  );
}
