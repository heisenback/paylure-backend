// src/pixels/pixels.controller.ts
import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards, Patch } from '@nestjs/common';
import { PixelsService } from './pixels.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import { User } from '@prisma/client';

@UseGuards(AuthGuard('jwt'))
@Controller('pixels')
export class PixelsController {
  constructor(private readonly pixelsService: PixelsService) {}

  @Post()
  create(@GetUser() user: User, @Body() createPixelDto: CreatePixelDto) {
    return this.pixelsService.create(user.id, createPixelDto);
  }

  @Get()
  async findAll(@GetUser() user: User) {
    const pixels = await this.pixelsService.findAll(user.id);
    return { data: pixels }; // Retorna no formato que o front espera { data: [...] }
  }

  @Put(':id')
  update(
    @GetUser() user: User,
    @Param('id') id: string, 
    @Body() createPixelDto: CreatePixelDto
  ) {
    return this.pixelsService.update(id, user.id, createPixelDto);
  }

  @Patch(':id/toggle')
  toggle(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body('active') active: boolean
  ) {
    return this.pixelsService.toggleActive(id, user.id, active);
  }

  @Delete(':id')
  remove(@GetUser() user: User, @Param('id') id: string) {
    return this.pixelsService.remove(id, user.id);
  }
}