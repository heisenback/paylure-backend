import { Test, TestingModule } from '@nestjs/testing';
import { PaymentLinkController } from './payment-link.controller';

describe('PaymentLinkController', () => {
  let controller: PaymentLinkController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentLinkController],
    }).compile();

    controller = module.get<PaymentLinkController>(PaymentLinkController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
