import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { HostCacheSettingsSection } from "~/components/hosts/cache-settings-section"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { parseLineList } from "~/lib/form-utils"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { configDotBatch, configDotGet } from "~/sdk/config"

type CacheNetrcSettings = {
  enable: boolean
  secretName: string
  path: string
  narinfoCachePositiveTtl: number
}

type CacheSettings = {
  substituters: string[]
  trustedPublicKeys: string[]
  netrc: CacheNetrcSettings
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeCache(cache: unknown): CacheSettings {
  const cacheRecord = asRecord(cache) ?? {}
  const netrcRecord = asRecord(cacheRecord.netrc) ?? {}
  return {
    substituters: Array.isArray(cacheRecord.substituters) ? cacheRecord.substituters.map(String) : [],
    trustedPublicKeys: Array.isArray(cacheRecord.trustedPublicKeys) ? cacheRecord.trustedPublicKeys.map(String) : [],
    netrc: {
      enable: Boolean(netrcRecord.enable),
      secretName: typeof netrcRecord.secretName === "string" ? netrcRecord.secretName : "garnix_netrc",
      path: typeof netrcRecord.path === "string" ? netrcRecord.path : "/etc/nix/netrc",
      narinfoCachePositiveTtl:
        typeof netrcRecord.narinfoCachePositiveTtl === "number"
          ? netrcRecord.narinfoCachePositiveTtl
          : 3600,
    },
  }
}

export const Route = createFileRoute("/$projectSlug/cache")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((item) => slugifyProjectName(item.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
  },
  component: CachePage,
})

function CachePage() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"

  const hostsConfigQueryKey = ["cacheHostsConfig", projectId] as const
  const hostsConfigQuery = useQuery({
    queryKey: hostsConfigQueryKey,
    enabled: Boolean(projectId && isReady),
    queryFn: async () => {
      const node = await configDotGet({
        data: {
          projectId: projectId as Id<"projects">,
          path: "hosts",
        },
      })
      return asRecord(node.value) ?? {}
    },
  })

  const hostCaches = useMemo(() => {
    const hosts = Object.entries(hostsConfigQuery.data ?? {}).toSorted(([a], [b]) => a.localeCompare(b))
    return hosts.map(([host, hostCfg]) => ({
      host,
      cache: normalizeCache(asRecord(hostCfg)?.cache),
    }))
  }, [hostsConfigQuery.data])

  const cacheDivergedHosts = useMemo(() => {
    const [first] = hostCaches
    if (!first) return []
    const baseline = JSON.stringify(first.cache)
    return hostCaches
      .filter((entry) => JSON.stringify(entry.cache) !== baseline)
      .map((entry) => entry.host)
      .filter((host) => host !== first.host)
  }, [hostCaches])

  if (projectQuery.isPending || hostsConfigQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (projectStatus === "creating") {
    return <div className="text-muted-foreground">Project setup in progress. Refresh after the run completes.</div>
  }
  if (projectStatus === "error") {
    return <div className="text-sm text-destructive">Project setup failed. Check Runs for details.</div>
  }
  if (hostsConfigQuery.error) {
    return <div className="text-sm text-destructive">{String(hostsConfigQuery.error)}</div>
  }
  if (hostCaches.length === 0) {
    return <div className="text-muted-foreground">Add a host first to configure cache policy.</div>
  }

  const hostNames = hostCaches.map((entry) => entry.host)
  const initialCache = hostCaches[0]?.cache ?? normalizeCache(null)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-black tracking-tight">Cache</h1>
        <p className="text-muted-foreground">Project-wide Nix binary cache policy (applies to all hosts).</p>
      </div>

      {cacheDivergedHosts.length > 0 ? (
        <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-100">
          <AlertTitle>Hosts have different cache settings</AlertTitle>
          <AlertDescription>
            Saving here overwrites <code className="text-xs">hosts.*.cache</code> for all hosts. Diverged:{" "}
            <code className="text-xs">{cacheDivergedHosts.join(", ")}</code>
          </AlertDescription>
        </Alert>
      ) : null}

      <CacheSettingsForm
        key={`${projectId}:${hostsConfigQuery.dataUpdatedAt}`}
        projectId={projectId}
        hostNames={hostNames}
        queryKey={hostsConfigQueryKey}
        initialCache={initialCache}
      />
    </div>
  )
}

function CacheSettingsForm(props: {
  projectId: Id<"projects">
  hostNames: string[]
  queryKey: readonly unknown[]
  initialCache: CacheSettings
}) {
  const queryClient = useQueryClient()
  const [cacheSubstitutersText, setCacheSubstitutersText] = useState(props.initialCache.substituters.join("\n"))
  const [cacheTrustedKeysText, setCacheTrustedKeysText] = useState(props.initialCache.trustedPublicKeys.join("\n"))
  const [cacheNetrcEnable, setCacheNetrcEnable] = useState(props.initialCache.netrc.enable)
  const [cacheNetrcSecretName, setCacheNetrcSecretName] = useState(props.initialCache.netrc.secretName)
  const [cacheNetrcPath, setCacheNetrcPath] = useState(props.initialCache.netrc.path)
  const [cacheNarinfoCachePositiveTtl, setCacheNarinfoCachePositiveTtl] = useState(String(props.initialCache.netrc.narinfoCachePositiveTtl))

  const save = useMutation({
    mutationFn: async () => {
      if (props.hostNames.length === 0) throw new Error("no hosts found (add a host first)")

      const cacheSubstituters = parseLineList(cacheSubstitutersText)
      const cacheTrustedPublicKeys = parseLineList(cacheTrustedKeysText)
      if (cacheSubstituters.length === 0) throw new Error("Cache substituters must not be empty.")
      if (cacheTrustedPublicKeys.length === 0) throw new Error("Cache trusted public keys must not be empty.")

      const narinfoTtlRaw = cacheNarinfoCachePositiveTtl.trim()
      const narinfoTtl = Number(narinfoTtlRaw)
      if (!Number.isInteger(narinfoTtl) || narinfoTtl <= 0) throw new Error("Cache narinfo TTL must be a positive integer.")

      const netrcSecretName = cacheNetrcSecretName.trim()
      const netrcPath = cacheNetrcPath.trim()
      if (cacheNetrcEnable && !netrcSecretName) throw new Error("Cache netrc secret name is required when enabled.")
      if (cacheNetrcEnable && !netrcPath) throw new Error("Cache netrc path is required when enabled.")

      const cacheNext: CacheSettings = {
        substituters: cacheSubstituters,
        trustedPublicKeys: cacheTrustedPublicKeys,
        netrc: {
          enable: cacheNetrcEnable,
          secretName: netrcSecretName,
          path: netrcPath,
          narinfoCachePositiveTtl: narinfoTtl,
        },
      }

      return await configDotBatch({
        data: {
          projectId: props.projectId,
          ops: props.hostNames.map((host) => ({
            path: `hosts.${host}.cache`,
            valueJson: JSON.stringify(cacheNext),
          })),
        },
      })
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: props.queryKey })
      } else {
        toast.error("Validation failed")
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  return (
    <HostCacheSettingsSection
      host="*"
      saving={save.isPending}
      onSave={() => save.mutate()}
      substitutersText={cacheSubstitutersText}
      setSubstitutersText={setCacheSubstitutersText}
      trustedKeysText={cacheTrustedKeysText}
      setTrustedKeysText={setCacheTrustedKeysText}
      netrcEnable={cacheNetrcEnable}
      setNetrcEnable={setCacheNetrcEnable}
      netrcSecretName={cacheNetrcSecretName}
      setNetrcSecretName={setCacheNetrcSecretName}
      netrcPath={cacheNetrcPath}
      setNetrcPath={setCacheNetrcPath}
      narinfoCachePositiveTtl={cacheNarinfoCachePositiveTtl}
      setNarinfoCachePositiveTtl={setCacheNarinfoCachePositiveTtl}
    />
  )
}
