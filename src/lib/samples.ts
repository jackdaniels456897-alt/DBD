export interface Sample {
  id: string;
  name: string;
  description: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'blog',
    name: 'Blog',
    description: 'sintaxe QuickDBD (nome + traços)',
    text: `# Sintaxe QuickDBD: nome da tabela, linha de tracos e colunas
Users
-
id int PK
username varchar UNIQUE
email varchar UNIQUE
password_hash varchar
created_at datetime

Posts
-
id int PK
user_id int FK >- Users.id
title varchar
slug varchar UNIQUE
body text
published boolean
created_at datetime

Comments
-
id int PK
post_id int FK >- Posts.id
user_id int FK >- Users.id
parent_id int FK >- Comments.id NULL
body text
created_at datetime

Tags
-
id int PK
name varchar UNIQUE

PostTags
-
post_id int PK FK >- Posts.id
tag_id int PK FK >- Tags.id

Profiles
-
user_id int PK FK - Users.id
bio text NULL
avatar_url varchar NULL
`,
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    description: 'pedidos, produtos e pagamentos',
    text: `Customers
-
id int PK
name varchar
email varchar UNIQUE
phone varchar NULL
created_at datetime

Addresses
-
id int PK
customer_id int FK >- Customers.id
line1 varchar
city varchar
state char(2)
zip varchar
is_default boolean

Categories
-
id int PK
name varchar UNIQUE
parent_id int FK >- Categories.id NULL

Products
-
id int PK
category_id int FK >- Categories.id
sku varchar UNIQUE
name varchar
price decimal(10,2)
stock int
active boolean

Orders
-
id int PK
customer_id int FK >- Customers.id
address_id int FK >- Addresses.id
status varchar
total decimal(10,2)
placed_at datetime

OrderItems
-
id int PK
order_id int FK >- Orders.id
product_id int FK >- Products.id
quantity int
unit_price decimal(10,2)

Payments
-
id int PK
order_id int FK -0 Orders.id
method varchar
amount decimal(10,2)
paid_at datetime NULL
`,
  },
  {
    id: 'braces',
    name: 'Sintaxe com chaves',
    description: 'estilo dbdiagram com [atributos]',
    text: `// Também aceitamos o estilo com chaves e atributos entre colchetes
users {
  id int [pk, increment]
  email varchar [unique]
  full_name varchar
  created_at timestamp [default:now()]
}

teams {
  id int [pk, increment]
  name varchar [unique]
  owner_id int [ref: > users.id]
}

memberships {
  id int [pk, increment]
  team_id int [ref: > teams.id]
  user_id int [ref: > users.id]
  role varchar [default:member]
  joined_at timestamp
}

projects {
  id int [pk, increment]
  team_id int [ref: > teams.id]
  name varchar
  archived boolean [default:false]
}
`,
  },
];
