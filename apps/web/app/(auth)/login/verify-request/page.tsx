import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';

export default function VerifyRequestPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Проверьте почту</CardTitle>
        <CardDescription>
          Мы отправили ссылку для входа на ваш email. Откройте её в этом же браузере.
        </CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
