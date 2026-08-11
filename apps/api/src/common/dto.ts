import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class MonthQueryDto {
  @ApiPropertyOptional({ example: '2026-07', description: 'Competencia YYYY-MM.' })
  @IsOptional()
  @Matches(YEAR_MONTH_REGEX, { message: 'month deve estar no formato YYYY-MM.' })
  month?: string;
}

export class HorizonQueryDto extends MonthQueryDto {
  @ApiPropertyOptional({ example: '2026-08', description: 'Primeira competencia do horizonte.' })
  @IsOptional()
  @Matches(YEAR_MONTH_REGEX, { message: 'from deve estar no formato YYYY-MM.' })
  from?: string;

  @ApiPropertyOptional({ example: 6, description: 'Numero de meses projetados (1-36).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;
}

export class PaginationDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}

export class SearchDto {
  @ApiPropertyOptional({ description: 'Busca por descricao, estabelecimento ou valor.' })
  @IsOptional()
  @IsString()
  search?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}
