/**
 * GET /api/v1/withdrawals/preview?amount=10000
 * Mostra quanto o usuário vai receber antes de confirmar
 */
@Get('preview')
async previewWithdrawal(
  @GetUser() user: any,
  @Query('amount') amount: string,
) {
  const amountInCents = parseInt(amount, 10);
  
  if (!amountInCents || amountInCents <= 0) {
    throw new BadRequestException('Valor inválido');
  }
  
  return await this.withdrawalService.previewWithdrawal(user.id, amountInCents);
}