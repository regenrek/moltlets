"use client"

import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { singleHostCidrFromIp } from "~/lib/ip-utils"
import { LabelWithHelp } from "~/components/ui/label-help"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"

export function AdminCidrField(props: {
  id: string
  label: string
  help?: React.ReactNode
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  description?: React.ReactNode
  autoDetectIfEmpty?: boolean
  detecting?: boolean
  onDetect?: () => void
  detectionError?: string | null
}) {
  const [detecting, setDetecting] = useState(false)
  const externalDetecting = typeof props.detecting === "boolean" ? props.detecting : null
  const isDetecting = externalDetecting ?? detecting

  const attemptedAutoDetectRef = useRef(false)
  const latestValueRef = useRef(props.value)

  // Keep the latest value available for async auto-detect without extra effects.
  latestValueRef.current = props.value

  async function detect(mode: "auto" | "manual") {
    setDetecting(true)
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6000)
    try {
      const res = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal })
      if (!res.ok) throw new Error(`ip lookup failed (${res.status})`)
      const json = (await res.json()) as { ip?: unknown }
      const ip = typeof json.ip === "string" ? json.ip : ""
      const cidr = singleHostCidrFromIp(ip)
      // If we auto-detect but the user already typed a value, don't overwrite it.
      if (mode === "auto" && latestValueRef.current.trim()) return
      props.onValueChange(cidr)
      if (mode === "manual") {
        toast.success(`Admin CIDR set to ${cidr}`)
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "timed out"
          : err instanceof Error
            ? err.message
            : String(err)
      if (mode === "manual") {
        toast.error(`Admin CIDR detect failed: ${msg}`)
      }
    } finally {
      clearTimeout(timeout)
      setDetecting(false)
    }
  }

  useEffect(() => {
    if (props.onDetect) return
    if (!props.autoDetectIfEmpty) return
    if (attemptedAutoDetectRef.current) return
    attemptedAutoDetectRef.current = true
    if (props.value.trim()) return
    void detect("auto")
  }, [props.autoDetectIfEmpty, props.onDetect]) // oxlint-disable-line react/exhaustive-deps -- run-once on mount

  const runDetect = () => {
    if (props.onDetect) {
      props.onDetect()
      return
    }
    void detect("manual")
  }

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
          placeholder={props.placeholder || "203.0.113.10/32"}
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  type="button"
                  variant="secondary"
                  disabled={isDetecting}
                  onClick={runDetect}
                >
                  <ArrowPathIcon className={isDetecting ? "animate-spin" : ""} />
                  Detect
                </InputGroupButton>
              }
            />
            <TooltipContent side="top" align="end">
              Detect from your current public IP (via ipify).
            </TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      {props.description ? (
        <div className="text-xs text-muted-foreground">{props.description}</div>
      ) : null}
      {props.detectionError ? (
        <div className="text-xs text-destructive">{props.detectionError}</div>
      ) : null}
    </div>
  )
}
