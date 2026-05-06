import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';

export function PlaceholderPage({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
      </Card>
    </div>
  );
}
