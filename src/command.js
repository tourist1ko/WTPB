export const command = {
  name: 'pb',
  description: 'Полковые бои War Thunder',
  type: 1,
  options: [{type: 1, name: 'br', description: 'Показать текущий БР полковых боёв'}],
};

export async function handleInteraction(interaction, service, guildId) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'pb' || interaction.guildId !== guildId) return;
  await interaction.deferReply();
  if (interaction.options.getSubcommand(false) !== 'br') {
    await interaction.editReply('Доступна команда /pb br.');
    return;
  }
  const br = await service.getBR();
  await interaction.editReply(br ? `БР ${br}` : 'Текущий БР недоступен. Официальное расписание пока не получено.');
}
