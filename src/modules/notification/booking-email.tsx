import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';

export type BookingEmailProps = {
  preview: string;
  greeting: string;
  /** 目立たせる一文（「まだ予約は確定していません」など） */
  notice?: string;
  intro: string;
  rows: { label: string; value: string }[];
  /** 表のあとに続く文章のまとまり（支払方法・確定までの流れなど。改行はそのまま出す） */
  sections?: { title: string; body: string }[];
  /** 予約確認ページ・管理画面へのボタン（取消のお知らせなどでは省略する） */
  buttonLabel?: string;
  buttonUrl?: string;
  footer: string;
};

/** 文言は呼び出し側で翻訳済みのものを渡す（言語に依存しないテンプレート） */
export function BookingEmail(props: BookingEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={{ backgroundColor: '#f4f7f9', fontFamily: 'sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', maxWidth: '560px' }}>
          <Heading as="h2">{props.greeting}</Heading>
          {props.notice && (
            <Text
              style={{
                backgroundColor: '#fff7ed',
                border: '1px solid #fdba74',
                borderRadius: '6px',
                color: '#9a3412',
                fontWeight: 700,
                padding: '10px 12px',
              }}
            >
              {props.notice}
            </Text>
          )}
          <Text>{props.intro}</Text>
          <Section>
            {props.rows.map((row) => (
              <Text key={row.label} style={{ margin: '4px 0', whiteSpace: 'pre-line' }}>
                <strong>{row.label}</strong>：{row.value}
              </Text>
            ))}
          </Section>
          {props.sections?.map((section) => (
            <Section key={section.title} style={{ marginTop: '16px' }}>
              <Text style={{ fontWeight: 700, margin: '0 0 4px' }}>{section.title}</Text>
              <Text style={{ margin: 0, whiteSpace: 'pre-line' }}>{section.body}</Text>
            </Section>
          ))}
          {props.buttonUrl && props.buttonLabel && (
            <Section style={{ margin: '24px 0' }}>
              <Button
                href={props.buttonUrl}
                style={{ backgroundColor: '#0e7490', color: '#ffffff', padding: '12px 20px', borderRadius: '6px' }}
              >
                {props.buttonLabel}
              </Button>
            </Section>
          )}
          <Hr />
          <Text style={{ color: '#6b7280', fontSize: '12px' }}>{props.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
