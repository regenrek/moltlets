import { useMutation } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { toast } from "sonner"
import { looksLikeSshPrivateKeyText, looksLikeSshPublicKeyText } from "~/lib/form-utils"
import { detectLocalSshPubkeyFiles } from "~/sdk/security"
import { Button } from "~/components/ui/button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"

export function SshPubkeyFileField(props: {
  id: string
  label: string
  help?: string
  value: string
  onValueChange: (next: string) => void
}) {
  const [detected, setDetected] = useState<string[] | null>(null)
  const [detectedBaseDir, setDetectedBaseDir] = useState<string | null>(null)

  const detect = useMutation({
    mutationFn: async () => await detectLocalSshPubkeyFiles(),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      setDetected(res.files)
      setDetectedBaseDir(res.baseDir)
      if (!props.value.trim() && res.files.length === 1) {
        props.onValueChange(res.files[0] || "")
        toast.success("Found 1 public key")
      } else {
        toast.success(`Found ${res.files.length} public key${res.files.length === 1 ? "" : "s"}`)
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const footer = useMemo(() => {
    const v = props.value.trim()
    if (!v) {
      return (
        <div className="text-xs text-destructive">
          Required for provisioning. This is a local path on the machine running bootstrap.
        </div>
      )
    }
    if (looksLikeSshPrivateKeyText(v)) {
      return <div className="text-xs text-destructive">Private key detected. Do not paste secrets here.</div>
    }
    if (looksLikeSshPublicKeyText(v)) {
      return (
        <div className="text-xs text-destructive">
          Looks like SSH key contents. This field expects a file path (example: <code>~/.ssh/id_ed25519.pub</code>).
        </div>
      )
    }
    if (!v.endsWith(".pub")) {
      return (
        <div className="text-xs text-muted-foreground">
          Warning: does not end with <code>.pub</code>. Double-check this is a public key file path.
        </div>
      )
    }
    return (
      <div className="text-xs text-muted-foreground">
        The dashboard can’t read your filesystem; the CLI validates this path when you run bootstrap/infra.
      </div>
    )
  }, [props.value])

  return (
    <div className="space-y-2">
      <LabelWithHelp htmlFor={props.id} help={props.help}>
        {props.label}
      </LabelWithHelp>
      <InputGroup>
        <InputGroupInput
          id={props.id}
          value={props.value}
          onChange={(e) => props.onValueChange(e.target.value)}
          placeholder="~/.ssh/id_ed25519.pub"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            variant="secondary"
            disabled={detect.isPending}
            pending={detect.isPending}
            pendingText="Detecting..."
            onClick={() => detect.mutate()}
          >
            <ArrowPathIcon />
            Detect
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      <div className="text-xs text-muted-foreground">
        Detect looks for <code>*.pub</code> under <code>{detectedBaseDir ?? "~/.ssh"}</code> on the machine running Clawlets (the same machine
        you’ll run bootstrap from).
      </div>

      {detected ? (
        detected.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No public keys found in <code>~/.ssh</code>. Generate one:
            <div className="mt-1">
              <code>ssh-keygen -t ed25519 -a 100 -f ~/.ssh/id_ed25519</code>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {detected.slice(0, 6).map((p) => (
              <Button key={p} type="button" size="xs" variant="outline" onClick={() => props.onValueChange(p)}>
                Use {p}
              </Button>
            ))}
            {detected.length > 6 ? (
              <div className="text-xs text-muted-foreground">+{detected.length - 6} more</div>
            ) : null}
          </div>
        )
      ) : null}

      {footer}
    </div>
  )
}
