import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { AsyncButton } from "~/components/ui/async-button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { SettingsSection } from "~/components/ui/settings-section"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { maskKnownHostEntry, maskSshPublicKey } from "~/lib/ssh-redaction"
import { addProjectSshKeys, removeProjectSshAuthorizedKey, removeProjectSshKnownHost } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/security/ssh-keys")({
  component: SecuritySshKeys,
})

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return Array.from(new Set(normalized))
}

const DEPLOY_CREDS_RECONCILE_DELAYS_MS = [800, 2_000, 5_000] as const

function SecuritySshKeys() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const credentialsQuery = useQuery({
    ...convexQuery(
      api.controlPlane.projectCredentials.listByProject,
      projectId ? { projectId: projectId as Id<"projects"> } : "skip",
    ),
  })
  const fleetSshKeys = useMemo(
    () => {
      const bySection = new Map((credentialsQuery.data ?? []).map((row) => [row.section, row]))
      const authorized = bySection.get("sshAuthorizedKeys")?.metadata?.stringItems
      const knownHosts = bySection.get("sshKnownHosts")?.metadata?.stringItems
      return {
        authorized: normalizeStringArray(authorized),
        knownHosts: normalizeStringArray(knownHosts),
      }
    },
    [credentialsQuery.data],
  )

  const [keyText, setKeyText] = useState("")
  const [knownHostsText, setKnownHostsText] = useState("")

  async function importTextFile(file: File, opts: { maxBytes: number }): Promise<string> {
    if (file.size > opts.maxBytes) throw new Error(`file too large (> ${Math.ceil(opts.maxBytes / 1024)}KB)`)
    return await file.text()
  }

  const addSsh = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("missing project")
      return await addProjectSshKeys({
        data: {
          projectId: projectId as Id<"projects">,
          keyText,
          knownHostsText,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Updated SSH settings")
        setKeyText("")
        setKnownHostsText("")
        for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
          setTimeout(() => {
            void credentialsQuery.refetch()
          }, delayMs)
        }
      } else toast.error("Failed")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  const removeAuthorizedKey = useMutation({
    mutationFn: async (key: string) => {
      if (!projectId) throw new Error("missing project")
      return await removeProjectSshAuthorizedKey({
        data: { projectId: projectId as Id<"projects">, key },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Removed SSH key")
        for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
          setTimeout(() => {
            void credentialsQuery.refetch()
          }, delayMs)
        }
      } else toast.error("Failed")
    },
  })

  const removeKnownHost = useMutation({
    mutationFn: async (entry: string) => {
      if (!projectId) throw new Error("missing project")
      return await removeProjectSshKnownHost({
        data: { projectId: projectId as Id<"projects">, entry },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Removed known_hosts entry")
        for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
          setTimeout(() => {
            void credentialsQuery.refetch()
          }, delayMs)
        }
      } else toast.error("Failed")
    },
  })

  if (projectQuery.isPending || credentialsQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (credentialsQuery.error) {
    return <div className="text-sm text-destructive">{String(credentialsQuery.error)}</div>
  }
  return (
    <div className="space-y-6">
      <SettingsSection
        title="SSH Keys"
        description={<>Manage project-level authorized keys and known hosts shared across all hosts.</>}
        actions={
          <AsyncButton
            disabled={addSsh.isPending}
            pending={addSsh.isPending}
            pendingText="Adding SSH keys..."
            onClick={() => addSsh.mutate()}
          >
            Add SSH Keys
          </AsyncButton>
        }
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <LabelWithHelp htmlFor="keyText" help={setupFieldHelp.hosts.sshKeyPaste}>
                Paste public keys
              </LabelWithHelp>
              <Textarea
                id="keyText"
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                className="font-mono min-h-[100px]"
                placeholder="ssh-ed25519 AAAA... user@host"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <LabelWithHelp htmlFor="knownHostsText" help={setupFieldHelp.hosts.knownHostsFile}>
                Paste known_hosts entries (optional)
              </LabelWithHelp>
              <Textarea
                id="knownHostsText"
                value={knownHostsText}
                onChange={(e) => setKnownHostsText(e.target.value)}
                className="font-mono min-h-[80px]"
                placeholder="github.com ssh-ed25519 AAAA..."
              />
            </div>

            <div className="space-y-2">
              <LabelWithHelp htmlFor="keyFile" help={setupFieldHelp.hosts.sshKeyFile}>
                Upload public key file (.pub)
              </LabelWithHelp>
              <Input
                id="keyFile"
                type="file"
                accept=".pub,text/plain"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  void (async () => {
                    try {
                      const text = await importTextFile(file, { maxBytes: 64 * 1024 })
                      setKeyText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}\n` : `${text}\n`))
                      toast.success(`Imported ${file.name}`)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err))
                    } finally {
                      e.currentTarget.value = ""
                    }
                  })()
                }}
              />
              <div className="text-xs text-muted-foreground">
                Reads locally in your browser; server never reads <code>~/.ssh</code>.
              </div>
            </div>

            <div className="space-y-2">
              <LabelWithHelp htmlFor="knownHosts" help={setupFieldHelp.hosts.knownHostsFile}>
                Upload known_hosts file
              </LabelWithHelp>
              <Input
                id="knownHosts"
                type="file"
                accept="text/plain"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  void (async () => {
                    try {
                      const text = await importTextFile(file, { maxBytes: 256 * 1024 })
                      setKnownHostsText((prev) =>
                        prev.trim() ? `${prev.trimEnd()}\n${text}\n` : `${text}\n`,
                      )
                      toast.success(`Imported ${file.name}`)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err))
                    } finally {
                      e.currentTarget.value = ""
                    }
                  })()
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Authorized keys</div>
              <div className="rounded-md border bg-card p-3">
                {fleetSshKeys.authorized.length === 0 ? (
                  <div className="text-sm text-muted-foreground">None</div>
                ) : (
                  <div className="space-y-2">
                    {fleetSshKeys.authorized.map((k: string) => (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <code className="text-xs break-all">{maskSshPublicKey(k)}</code>
                        <AsyncButton
                          size="sm"
                          variant="secondary"
                          onClick={() => removeAuthorizedKey.mutate(k)}
                          disabled={removeAuthorizedKey.isPending}
                          pending={removeAuthorizedKey.isPending}
                          pendingText="Removing..."
                        >
                          Remove
                        </AsyncButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">known_hosts</div>
              <div className="rounded-md border bg-card p-3">
                {fleetSshKeys.knownHosts.length === 0 ? (
                  <div className="text-sm text-muted-foreground">None</div>
                ) : (
                  <div className="space-y-2">
                    {fleetSshKeys.knownHosts.map((entry: string) => (
                      <div key={entry} className="flex items-center justify-between gap-2">
                        <code className="text-xs break-all">{maskKnownHostEntry(entry)}</code>
                        <AsyncButton
                          size="sm"
                          variant="secondary"
                          onClick={() => removeKnownHost.mutate(entry)}
                          disabled={removeKnownHost.isPending}
                          pending={removeKnownHost.isPending}
                          pendingText="Removing..."
                        >
                          Remove
                        </AsyncButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
