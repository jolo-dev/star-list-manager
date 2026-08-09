import type {RuntimeMessage, RuntimeResponse} from '../shared/messages'
import {safeLogMessage} from '../shared/logging'

const firefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

const dashboardPath = 'options/index.html'

interface PlatformTab {
  readonly id?: number
  readonly url?: string
  readonly windowId?: number
}

export function onToolbarClicked(listener: () => Promise<void>): void {
  const run = () => {
    void listener().catch((error: unknown) => {
      console.error('Unable to open the dashboard', safeLogMessage(error))
    })
  }

  if (firefoxLike) {
    browser.browserAction.onClicked.addListener(run)
  } else {
    chrome.action.onClicked.addListener(run)
  }
}

export async function openOrFocusDashboard(): Promise<void> {
  const url = runtimeUrl(dashboardPath)
  const tabs = (firefoxLike
    ? await browser.tabs.query({})
    : await chrome.tabs.query({})) as readonly PlatformTab[]
  const existing = tabs.find((tab: PlatformTab) => tab.url === url)

  if (existing?.id !== undefined) {
    if (firefoxLike) {
      await browser.tabs.update(existing.id, {active: true})
      if (existing.windowId !== undefined) {
        await browser.windows.update(existing.windowId, {focused: true})
      }
    } else {
      await chrome.tabs.update(existing.id, {active: true})
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, {focused: true})
      }
    }
    return
  }

  if (firefoxLike) {
    await browser.tabs.create({url})
  } else {
    await chrome.tabs.create({url})
  }
}

export function addRuntimeMessageListener(
  listener: (message: unknown) => Promise<RuntimeResponse>
): void {
  if (firefoxLike) {
    browser.runtime.onMessage.addListener((message: unknown) => listener(message))
    return
  }

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      void listener(message).then(sendResponse)
      return true
    }
  )
}

export async function sendRuntimeMessage(
  message: RuntimeMessage
): Promise<RuntimeResponse> {
  const response = firefoxLike
    ? await browser.runtime.sendMessage(message)
    : await chrome.runtime.sendMessage(message)
  return response as unknown as RuntimeResponse
}

export async function readLocalStorage(
  keys?: string | readonly string[]
): Promise<Readonly<Record<string, unknown>>> {
  const normalizedKeys = keys === undefined ? null : normalizeStorageKeys(keys)
  const values = firefoxLike
    ? await browser.storage.local.get(normalizedKeys)
    : await chrome.storage.local.get(normalizedKeys)
  return values as unknown as Readonly<Record<string, unknown>>
}

export async function writeLocalStorage(
  values: Readonly<Record<string, unknown>>
): Promise<void> {
  if (firefoxLike) {
    await browser.storage.local.set(values)
  } else {
    await chrome.storage.local.set(values)
  }
}

export async function removeLocalStorage(
  keys: string | readonly string[]
): Promise<void> {
  const normalizedKeys = normalizeStorageKeys(keys)
  if (firefoxLike) {
    await browser.storage.local.remove(normalizedKeys)
  } else {
    await chrome.storage.local.remove(normalizedKeys)
  }
}

export async function clearLocalStorage(): Promise<void> {
  if (firefoxLike) {
    await browser.storage.local.clear()
  } else {
    await chrome.storage.local.clear()
  }
}

export async function setToolbarBadge(
  text: string,
  backgroundColor = '#dd5b36'
): Promise<void> {
  if (firefoxLike) {
    await browser.browserAction.setBadgeBackgroundColor({color: backgroundColor})
    await browser.browserAction.setBadgeText({text})
  } else {
    await chrome.action.setBadgeBackgroundColor({color: backgroundColor})
    await chrome.action.setBadgeText({text})
  }
}

export async function createBrowserAlarm(name: string, when: number): Promise<void> {
  if (firefoxLike) {
    await browser.alarms.create(name, {when})
  } else {
    await chrome.alarms.create(name, {when})
  }
}

export async function clearBrowserAlarm(name: string): Promise<void> {
  if (firefoxLike) {
    await browser.alarms.clear(name)
  } else {
    await chrome.alarms.clear(name)
  }
}

export function onBrowserAlarm(name: string, listener: () => void): void {
  const run = (alarm: {readonly name: string}) => {
    if (alarm.name === name) listener()
  }
  if (firefoxLike) {
    browser.alarms.onAlarm.addListener(run)
  } else {
    chrome.alarms.onAlarm.addListener(run)
  }
}

export function onBrowserStartup(listener: () => void): void {
  if (firefoxLike) {
    browser.runtime.onStartup.addListener(listener)
  } else {
    chrome.runtime.onStartup.addListener(listener)
  }
}

export function runtimeUrl(path: string): string {
  return firefoxLike ? browser.runtime.getURL(path) : chrome.runtime.getURL(path)
}

function normalizeStorageKeys(keys: string | readonly string[]): string | string[] {
  return typeof keys === 'string' ? keys : [...keys]
}
