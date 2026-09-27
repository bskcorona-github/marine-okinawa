import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';

export type BookingConfirmedEmailProps = {
  preview: string;
  greeting: string;
  intro: string;
  rows: { label: string; value: string }[];
  buttonLabel: string;
  bookingUrl: string;
  footer: string;
};

/** 文言は呼び出し側で翻訳済みのものを渡す（言語に依存しないテンプレート） */
export function BookingConfirmedEmail(props: BookingConfirmedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={{ backgroundColor: '#f4f7f9', fontFamily: 'sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', maxWidth: '560px' }}>
          <Heading as="h2">{props.greeting}</Heading>
          <Text>{props.intro}</Text>
          <Section>
            {props.rows.map((row) => (
              <Text key={row.label} style={{ margin: '4px 0' }}>
                <strong>{row.label}</strong>：{row.value}
              </Text>
            ))}
          </Section>
          <Section style={{ margin: '24px 0' }}>
            <Button
              href={props.bookingUrl}
              style={{ backgroundColor: '#0e7490', color: '#ffffff', padding: '12px 20px', borderRadius: '6px' }}
            >
              {props.buttonLabel}
            </Button>
          </Section>
          <Hr />
          <Text style={{ color: '#6b7280', fontSize: '12px' }}>{props.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
