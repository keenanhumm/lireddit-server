import { User } from "../entities/User";
import { MyContext } from "../types";
import { Arg, Ctx, Mutation, Query, Resolver } from "type-graphql";
import argon2 from "argon2";
import UserCredentials from "../models/UserCredentials";
import UserResponse from "../models/UserResponse";
import { EntityManager } from "@mikro-orm/postgresql";
import { COOKIE_KEY } from "../constants";

@Resolver()
export class UserResolver {
  @Query(() => User, { nullable: true })
  async me(
    @Ctx() { em, req }: MyContext,
  ): Promise<User | null> {
    const { session: { userId: id }} = req;
    // caller is not logged in
    if (!id) return null;

    return await em.findOne(User, { id });
  }

  @Mutation(() => UserResponse)
  async register(
    @Ctx() { em, req }: MyContext,
    @Arg("credentials") { username, password }: UserCredentials,
  ): Promise<UserResponse> {
    // input validation
    if (username.length < 4) {
      return {
        errors: [
          {
            field: "username",
            message: "must be at least 4 characters long",
          },
        ],
      };
    }
    if (password.length < 4) {
      return {
        errors: [
          {
            field: "password",
            message: "must be at least 4 characters long",
          },
        ],
      };
    }
    // hash pwd
    const hashedPwd = await argon2.hash(password);

    let user;

    // persist user
    try {
      const result = await (em as EntityManager).createQueryBuilder(User).getKnexQuery().insert({
        username,
        password: hashedPwd,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning("*");

      user = result.map(e => em.map(User, e))[0];
    } catch ({ code, message }) {
      if (code === "23505") {
        // user already exists
        return {
          errors: [
            {
              field: "username",
              message: "username already taken",
            },
          ],
        };
      }
    }

    if (user) {
      req.session.userId = user.id;
    }

    return {
      user,
    };
  }

  @Mutation(() => UserResponse)
  async login(
    @Ctx() { em, req }: MyContext,
    @Arg("credentials") { username, password }: UserCredentials,
  ): Promise<UserResponse> {
    const user = await em.findOne(User, {
      username,
    });

    // check if user with that username was found
    if (!user) {
      return {
        errors: [
          {
            field: "username",
            message: "user does not exist!",
          },
        ],
      };
    }

    // verify password provided was correct
    const validPwd = await argon2.verify(user.password, password);
    if (!validPwd) {
      return {
        errors:[
          {
            field: "password",
            message: "incorrect password",
          },
        ],
      };
    }

    req.session.userId = user.id;

    return {
      user,
    };
  }

  @Mutation(() => Boolean)
  logout(
    @Ctx() { req, res }: MyContext,
  ){
    return new Promise(resolve => req.session.destroy(err => {
      res.clearCookie(COOKIE_KEY);
      resolve(!err);
      return;
    }));
  }
}