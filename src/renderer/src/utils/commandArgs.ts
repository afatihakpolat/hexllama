import type { CommandParam, CommandsSchema, Template } from '../../../shared/types'

type CommandArgs = Template['args']

export function isDefaultTrueBooleanCommand(command: Pick<CommandParam, 'arg' | 'type' | 'default'>): boolean {
  return command.type === 'boolean' && command.default === true && command.arg.startsWith('--')
}

export function getBooleanCommandFlag(command: Pick<CommandParam, 'arg' | 'type' | 'default'>, value: unknown): string | null {
  if (command.type !== 'boolean') {
    return null
  }

  if (value === true) {
    return command.arg
  }

  if (value === false && isDefaultTrueBooleanCommand(command)) {
    return `--no-${command.arg.slice(2)}`
  }

  return null
}

function buildArgAliasMap(commandsSchema: CommandsSchema | null): Map<string, string> {
  const aliasMap = new Map<string, string>()

  if (!commandsSchema) return aliasMap

  for (const category of commandsSchema.categories) {
    for (const command of category.commands) {
      aliasMap.set(command.arg, command.arg)
      if (command.short) aliasMap.set(command.short, command.arg)
      if (isDefaultTrueBooleanCommand(command)) {
        aliasMap.set(`--no-${command.arg.slice(2)}`, command.arg)
      }
    }
  }

  return aliasMap
}

function buildCommandMap(commandsSchema: CommandsSchema | null): Map<string, CommandParam> {
  const commandMap = new Map<string, CommandParam>()

  if (!commandsSchema) return commandMap

  for (const category of commandsSchema.categories) {
    for (const command of category.commands) {
      commandMap.set(command.arg, command)
    }
  }

  return commandMap
}

export function normalizeCommandArgs(args: CommandArgs, commandsSchema: CommandsSchema | null): CommandArgs {
  const aliasMap = buildArgAliasMap(commandsSchema)
  const commandMap = buildCommandMap(commandsSchema)
  if (aliasMap.size === 0) return { ...args }

  const normalizedArgs: CommandArgs = {}

  for (const [key, value] of Object.entries(args)) {
    const canonicalKey = aliasMap.get(key) || key
    const existingValue = normalizedArgs[canonicalKey]
    const command = commandMap.get(canonicalKey)
    let normalizedValue = value

    if (key.startsWith('--no-') && aliasMap.has(key)) {
      if (value === true) {
        normalizedValue = false
      } else {
        continue
      }
    }

    if (command && isDefaultTrueBooleanCommand(command) && normalizedValue === true) {
      continue
    }

    if (existingValue === undefined || canonicalKey === key) {
      normalizedArgs[canonicalKey] = normalizedValue
    }
  }

  return normalizedArgs
}
