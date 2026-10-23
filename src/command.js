export const command = {
  name: 'pb',
  description: 'Полковые бои War Thunder',
  type: 1,
  options: [{type: 1, name: 'br', description: 'Текущий и следующий БР, дата смены'}],
};

export function formatBR(info){
  if(!info)return 'Қәзіргі БР - белгісіз\nКелесі БР - белгісіз';
  const next=info.next?`${info.next.br} (${info.next.start.split('-').reverse().join('.')})`:'жарияланбаған';
  return `Қәзіргі БР - ${info.current}\nКелесі БР - ${next}`;
}

export async function handleInteraction(interaction, service, guildId) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'pb' || interaction.guildId !== guildId) return;
  await interaction.deferReply();
  if (interaction.options.getSubcommand(false) !== 'br') {
    await interaction.editReply('Доступна команда /pb br.');
    return;
  }
  const info = await service.getBRInfo();
  await interaction.editReply(formatBR(info));
}
