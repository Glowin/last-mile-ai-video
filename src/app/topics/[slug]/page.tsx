import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopicLanding } from "@/components/topic-landing";
import { getTopic, topicStaticParams } from "@/lib/topics";

export function generateStaticParams() {
  return topicStaticParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const topic = getTopic((await params).slug);
  if (!topic) return {};
  const title = topic.seo.title;
  const description = topic.seo.description;
  const canonical = `/topics/${topic.slug}`;
  return {
    title: { absolute: title },
    description,
    keywords: topic.seo.keywords,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: "KakaReel",
      locale: "en_US",
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const topic = getTopic((await params).slug);
  if (!topic) notFound();
  return <TopicLanding topic={topic} />;
}
