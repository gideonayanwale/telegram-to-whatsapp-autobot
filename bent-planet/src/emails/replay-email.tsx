import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface ReplayEmailProps {
  subscriberName: string;
  churchName: string;
  churchLogo?: string | null;
  conferenceTitle: string;
  streamUrl?: string | null;
  freeResourceUrl?: string | null;
  freeResourceName?: string | null;
  unsubscribeUrl?: string | null;
}

export const ReplayEmail = ({
  subscriberName,
  churchName,
  churchLogo,
  conferenceTitle,
  streamUrl,
  freeResourceUrl,
  freeResourceName,
  unsubscribeUrl,
}: ReplayEmailProps) => {
  const previewText = `The replay of ${conferenceTitle} is ready 🎥`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {churchLogo ? (
            <Img src={churchLogo} width="64" height="64" alt={churchName} style={logo} />
          ) : (
            <Heading style={churchHeader}>{churchName}</Heading>
          )}

          <Heading style={h1}>The replay is ready 🎥</Heading>

          <Text style={paragraph}>
            Hi {subscriberName}, thank you for joining us for <strong>{conferenceTitle}</strong>! The
            full replay is now available whenever you are ready to watch.
          </Text>

          <Section style={detailsCard}>
            <Text style={detailsTitle}>📺 Watch the replay</Text>
            <Text style={detailsText}>
              <strong>Event:</strong> {conferenceTitle}
              <br />
              <strong>Host:</strong> {churchName}
            </Text>
          </Section>

          {streamUrl ? (
            <Section style={{ textAlign: "center", margin: "32px 0" }}>
              <Button style={button} href={streamUrl}>
                Watch the Replay
              </Button>
            </Section>
          ) : null}

          {freeResourceUrl ? (
            <Section style={{ textAlign: "center", margin: "24px 0" }}>
              <Button style={secondaryButton} href={freeResourceUrl}>
                {freeResourceName || "Download your free resource"}
              </Button>
            </Section>
          ) : null}

          <Hr style={hr} />

          <Text style={footer}>Sent with love by {churchName} via Bent Planet</Text>
          {unsubscribeUrl ? (
            <Text style={subFooter}>
              Don&apos;t want these emails?{" "}
              <Link href={unsubscribeUrl} style={footerLink}>
                Unsubscribe
              </Link>
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: "#f6f9fc",
  fontFamilyFamily: "Arial, Helvetica, sans-serif",
  fontFamily: "Arial, Helvetica, sans-serif",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 32px",
  borderRadius: "12px",
  maxWidth: "560px",
};

const logo = { borderRadius: "12px", margin: "0 auto 8px auto", display: "block" };
const churchHeader = { color: "#4f46e5", fontSize: "16px", textAlign: "center" as const, margin: "0 0 16px" };
const h1 = { color: "#111827", fontSize: "26px", fontWeight: "bold" as const, margin: "16px 0" };
const paragraph = { color: "#374151", fontSize: "15px", lineHeight: "26px", margin: "16px 0" };
const detailsCard = {
  backgroundColor: "#eef2ff",
  borderRadius: "10px",
  padding: "18px 22px",
  margin: "24px 0",
};
const detailsTitle = { color: "#4338ca", fontSize: "14px", fontWeight: "bold" as const, margin: "0 0 8px" };
const detailsText = { color: "#1f2937", fontSize: "14px", lineHeight: "24px", margin: 0 };
const button = {
  backgroundColor: "#4f46e5",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "bold" as const,
  padding: "13px 26px",
  textDecoration: "none",
};
const secondaryButton = {
  backgroundColor: "#ffffff",
  border: "1.5px solid #c7d2fe",
  borderRadius: "8px",
  color: "#4338ca",
  fontSize: "14px",
  fontWeight: "bold" as const,
  padding: "12px 22px",
  textDecoration: "none",
};
const hr = { borderColor: "#e5e7eb", margin: "28px 0" };
const footer = { color: "#6b7280", fontSize: "12px", textAlign: "center" as const, margin: "8px 0" };
const subFooter = { color: "#9ca3af", fontSize: "11px", textAlign: "center" as const, margin: "4px 0 0" };
const footerLink = { color: "#6b7280", textDecoration: "underline" };
