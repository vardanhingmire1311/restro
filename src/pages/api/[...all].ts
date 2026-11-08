import type { NextApiRequest, NextApiResponse } from "next";
import { createApp } from "../../../server/app";

const app = createApp();

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return (app as unknown as (req: NextApiRequest, res: NextApiResponse) => void)(req, res);
}
