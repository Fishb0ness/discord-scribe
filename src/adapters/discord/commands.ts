import { Constants, type ChatInputApplicationCommandStructure } from '@projectdysnomia/dysnomia';

export const RECORD_COMMAND = 'grabar';
export const STOP_COMMAND = 'parar';

export const COMMANDS: ChatInputApplicationCommandStructure[] = [
  {
    type: Constants.ApplicationCommandTypes.CHAT_INPUT,
    name: RECORD_COMMAND,
    description: 'Graba el canal de voz en el que estás para transcribirlo y resumirlo',
    contexts: [Constants.InteractionContextTypes.GUILD]
  },
  {
    type: Constants.ApplicationCommandTypes.CHAT_INPUT,
    name: STOP_COMMAND,
    description: 'Detiene la grabación y genera la transcripción y el resumen',
    contexts: [Constants.InteractionContextTypes.GUILD]
  }
];
