import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';

const messages: Record<string, { title: string; body: string }> = {
  not_allowed: {
    title: 'Доступ закрыт',
    body: 'Этот email не зарегистрирован в giper-pm. Обратитесь к администратору, чтобы получить доступ.',
  },
  disabled: {
    title: 'Аккаунт отключён',
    body: 'Ваш аккаунт временно отключён. Обратитесь к администратору.',
  },
  default: {
    title: 'Не удалось войти',
    body: 'Что-то пошло не так. Попробуйте ещё раз или обратитесь к администратору.',
  },
};

export default async function LoginErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; error?: string }>;
}) {
  const { reason, error } = await searchParams;
  const key = reason ?? error ?? 'default';
  const msg = messages[key] ?? messages.default!;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{msg.title}</CardTitle>
        <CardDescription>{msg.body}</CardDescription>
      </CardHeader>
      <CardContent />
      <CardFooter>
        <Link href="/login" className="w-full">
          <Button variant="outline" className="w-full">
            Вернуться ко входу
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
