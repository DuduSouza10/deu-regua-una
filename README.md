# Deu Régua - Railway

Aplicação web completa para descoberta de barbearias, perfis de barbeiros, comparação, agendamentos, avaliações e gestão do estabelecimento.

## O que já está implementado

### Cliente
- Cadastro, login, logout e edição de perfil.
- Geolocalização pelo navegador e localização manual.
- Busca por barbearia ou barbeiro.
- Filtros por distância, preço máximo, estilo/tipo de corte, avaliação e ambiente.
- Ordenação por compatibilidade, avaliação, distância e preço.
- Perfil completo da barbearia com serviços, preços, profissionais, portfólio e avaliações.
- Perfil individual de barbeiro com especialidades, trabalhos e avaliação.
- Favoritos de barbearias e barbeiros.
- Preferências do cliente (corte, ambiente e faixa de preço).
- Comparação de até 3 barbearias.
- Agendamento por barbearia ou diretamente pelo barbeiro.
- Consulta e cancelamento de agendamentos.
- Avaliação da barbearia e do barbeiro após atendimento concluído.

### Barbearia
- Cadastro e edição do estabelecimento.
- Cadastro/edição/exclusão de barbeiros.
- Especialidades e horários semanais por barbeiro.
- Cadastro/edição/exclusão de serviços, preço, duração e estilos.
- Upload de fotos de trabalhos para o volume persistente.
- Gerenciamento de agendamentos e status: pendente, confirmado, concluído e cancelado.
- Visualização de avaliações recebidas.
- Relatórios: total de agendamentos, serviços mais procurados, horários de pico, avaliação média, novos clientes e barbeiros mais procurados.
- Seleção de modelo/plano: Freemium, Básico e Profissional.

### Administração
- Visão geral de usuários, barbearias e agendamentos.
- Ativar/suspender usuários.
- Ativar/suspender barbearias.
- Marcar/desmarcar barbearias em destaque.
- Visualizar e alterar o status de agendamentos.
- Visualizar e moderar avaliações publicadas.

## Contas de demonstração

- Cliente: `cliente@deuregua.app` / `demo123`
- Barbearia: `barbearia@deuregua.app` / `demo123`
- Administrador: `admin@deuregua.app` / `demo123`

As contas são criadas automaticamente na primeira inicialização, junto com dados de demonstração.

## Subir no Railway

1. Crie um novo projeto no Railway e suba este repositório/pasta.
2. No serviço, crie um **Volume** e monte exatamente em `/data`.
3. Em **Variables**, configure:
   - `DATA_DIR=/data`
   - `JWT_SECRET=<uma chave longa e aleatória>`
   - `NODE_ENV=production`
4. Faça o deploy. O Railway injeta a variável `PORT` automaticamente.

### Importante sobre persistência

O banco fica em `/data/db.json` e as imagens enviadas em `/data/uploads`. O volume deve ser criado diretamente no Railway e montado em `/data`. O `Dockerfile` não usa a instrução `VOLUME`, pois o Railway exige que a persistência seja configurada pelo recurso Railway Volumes.

## Rodar localmente

```bash
npm install
DATA_DIR=.data JWT_SECRET=dev-secret npm start
```

Acesse `http://localhost:3000`.

## Estrutura

- `server.js`: API, autenticação, persistência e regras de negócio.
- `public/index.html`: interface principal.
- `public/app.js`: SPA e integrações com a API.
- `public/styles.css`: layout responsivo.
- `public/assets`: imagens locais de demonstração.
- `/data/db.json`: banco persistente em produção.
- `/data/uploads`: imagens enviadas pelos estabelecimentos.

## Observações

- A distância é calculada por Haversine usando latitude/longitude do cliente e da barbearia.
- O projeto não depende de Google Maps nem de API paga para funcionar.
- Pagamentos reais não foram integrados; os modelos de monetização do escopo aparecem no sistema e o estabelecimento pode selecionar um plano. Destaque é controlado pelo administrador.
- Para produção com múltiplas réplicas simultâneas, recomenda-se migrar a camada de persistência JSON para PostgreSQL. Em um único serviço Railway, o volume atende ao MVP e ao escopo acadêmico.
