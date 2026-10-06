import { Constants, type ChatInputApplicationCommandStructure } from '@projectdysnomia/dysnomia';

export const RECORD_COMMAND = 'grabar';
export const STOP_COMMAND = 'parar';
export const NOTE_COMMAND = 'nota';
export const NOTE_OPTION = 'texto';
export const NOTE_MAX_LENGTH = 1000;

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
  },
  {
    type: Constants.ApplicationCommandTypes.CHAT_INPUT,
    name: NOTE_COMMAND,
    description: 'Añade una nota (por ejemplo un enlace) a la grabación en curso',
    contexts: [Constants.InteractionContextTypes.GUILD],
    options: [
      {
        type: Constants.ApplicationCommandOptionTypes.STRING,
        name: NOTE_OPTION,
        description: 'El texto o enlace que quieres que aparezca en la transcripción y el resumen',
        required: true,
        max_length: NOTE_MAX_LENGTH
      }
    ]
  }
];
