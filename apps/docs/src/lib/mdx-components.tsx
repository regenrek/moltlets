import defaultMdxComponents from 'fumadocs-ui/mdx'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import { Callout } from 'fumadocs-ui/components/callout'
import { Card, Cards } from 'fumadocs-ui/components/card'
import { Mermaid } from '@/components/mdx/mermaid'

export const mdxComponents = {
  ...defaultMdxComponents,
  Step,
  Steps,
  Tab,
  Tabs,
  File,
  Files,
  Folder,
  Callout,
  Card,
  Cards,
  Mermaid,
}
